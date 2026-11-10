// End-to-end smoke test against a running API with freshly seeded data.
//   npm run db:seed && npm run smoke -w apps/api
// It creates and cancels a few records, so run it on a development database only.

const BASE = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'chairtime-demo';
const PHONES = { owner: '+48600000001', admin: '+48600000002', barber: '+48600000011', otherBarber: '+48600000012', client: '+48600000021', client2: '+48600000022' };

let passed = 0;
const failures = [];
const check = (name, ok, extra = '') => {
  if (ok) passed += 1;
  else failures.push(`${name} ${extra}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : ` ${extra}`}`);
};

async function call(method, path, { token, body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, cookie: res.headers.getSetCookie?.()[0]?.split(';')[0] };
}

const login = async (phoneNumber) => {
  const r = await call('POST', '/auth/login', { body: { phoneNumber, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login failed for ${phoneNumber}: ${JSON.stringify(r.data)}`);
  return { token: r.data.accessToken, user: r.data.user, cookie: r.cookie };
};

const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function firstSlot(barberId, serviceId, fromOffset = 3) {
  for (let i = fromOffset; i < 29; i++) {
    const r = await call('GET', `/barbers/${barberId}/slots?serviceId=${serviceId}&date=${isoDate(i)}`);
    if (r.data?.slots?.length) return { date: isoDate(i), slot: r.data.slots[Math.floor(r.data.slots.length / 2)], all: r.data };
  }
  throw new Error('no slots found');
}

async function main() {
  console.log('\nPublic');
  const health = await call('GET', '/health');
  check('health is ok', health.status === 200 && health.data.status === 'ok');

  const services = (await call('GET', '/services')).data;
  check('services list "from" prices', services.length > 0 && services.every((s) => s.isActive) && services.some((s) => s.priceFrom > 0));
  const barbers = (await call('GET', '/barbers')).data;
  check('barber profiles expose no contact details', barbers.length === 4 && !JSON.stringify(barbers).includes('+48'));
  check('unauthenticated /users/me is 401', (await call('GET', '/users/me')).status === 401);
  check('errors use the documented shape', Object.keys((await call('GET', '/users/me')).data).join() === 'statusCode,message,error');
  check('validation errors carry details', Array.isArray((await call('POST', '/auth/login', { body: { phoneNumber: 'x' } })).data.details));

  const client = await login(PHONES.client);
  const client2 = await login(PHONES.client2);
  const barber = await login(PHONES.barber);
  const otherBarber = await login(PHONES.otherBarber);
  const admin = await login(PHONES.admin);
  const owner = await login(PHONES.owner);

  console.log('\nBooking');
  const kuba = barbers.find((b) => b.id === barber.user.barberId);
  const offer = kuba.services[0];
  const { slot, date, all } = await firstSlot(kuba.id, offer.serviceId);
  check('slot response carries duration, price and time', all.duration === offer.duration && all.price === offer.price && /^\d\d:\d\d$/.test(slot.time));

  const created = await call('POST', '/bookings', { token: client.token, body: { barberId: kuba.id, serviceId: offer.serviceId, startAt: slot.startAt } });
  check('client books a slot', created.status === 201 && created.data.status === 'BOOKED', JSON.stringify(created.data));
  const booking = created.data;
  check('price and duration are snapshotted', booking.priceSnapshot === offer.price && booking.durationSnapshot === offer.duration);
  check('endAt = start + duration + 15 min buffer', new Date(booking.endAt) - new Date(booking.startAt) === (offer.duration + 15) * 60_000);

  const dup = await call('POST', '/bookings', { token: client2.token, body: { barberId: kuba.id, serviceId: offer.serviceId, startAt: slot.startAt } });
  check('the same slot cannot be booked twice (409)', dup.status === 409 && dup.data.code === 'SLOT_TAKEN', JSON.stringify(dup.data));
  const after = await call('GET', `/barbers/${kuba.id}/slots?serviceId=${offer.serviceId}&date=${date}`);
  check('the taken slot is no longer offered', !after.data.slots.some((s) => s.startAt === slot.startAt));
  check('off-grid start is rejected (400)', (await call('POST', '/bookings', { token: client2.token, body: { barberId: kuba.id, serviceId: offer.serviceId, startAt: new Date(new Date(slot.startAt).getTime() + 7 * 60_000).toISOString() } })).status === 400);
  check('a booking in the past is rejected (409)', (await call('POST', '/bookings', { token: client2.token, body: { barberId: kuba.id, serviceId: offer.serviceId, startAt: '2026-01-05T10:00:00.000Z' } })).status === 409);
  check('barbers cannot create bookings (403)', (await call('POST', '/bookings', { token: barber.token, body: { barberId: kuba.id, serviceId: offer.serviceId, startAt: slot.startAt } })).status === 403);

  check("another client's booking is 404", (await call('GET', `/bookings/${booking.id}`, { token: client2.token })).status === 404);
  check('the assigned barber sees it', (await call('GET', `/bookings/${booking.id}`, { token: barber.token })).status === 200);
  check("another barber's booking is 404", (await call('GET', `/bookings/${booking.id}`, { token: otherBarber.token })).status === 404);
  check('clients cannot change status (403)', (await call('PATCH', `/bookings/${booking.id}/status`, { token: client.token, body: { status: 'COMPLETED' } })).status === 403);
  check('starting a visit days early is 409', (await call('PATCH', `/bookings/${booking.id}/status`, { token: barber.token, body: { status: 'IN_PROGRESS' } })).status === 409);
  check('CANCELED cannot be set through /status (400)', (await call('PATCH', `/bookings/${booking.id}/status`, { token: admin.token, body: { status: 'CANCELED' } })).status === 400);

  console.log('\nSchedule guards');
  const block = await call('POST', `/barbers/${kuba.id}/exceptions`, { token: barber.token, body: { date, type: 'BLOCKING' } });
  check('time off over a booking is refused (409)', block.status === 409 && block.data.details.bookings.length >= 1, JSON.stringify(block.data));
  const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const dayOff = await call('PUT', `/barbers/${kuba.id}/working-hours/${dayName}`, { token: barber.token, body: { intervals: [] } });
  check('removing working hours under bookings is refused (409)', dayOff.status === 409 && dayOff.data.code === 'BOOKINGS_IN_THE_WAY');
  check("a barber cannot edit another barber's hours (404)", (await call('GET', `/barbers/${kuba.id}/working-hours`, { token: otherBarber.token })).status === 404);
  check('clients cannot read schedules (403)', (await call('GET', `/barbers/${kuba.id}/working-hours`, { token: client.token })).status === 403);
  check('overlapping intervals are rejected (400)', (await call('PUT', `/barbers/${kuba.id}/working-hours/SUNDAY`, { token: barber.token, body: { intervals: [{ startTime: '10:00', endTime: '14:00' }, { startTime: '13:00', endTime: '16:00' }] } })).status === 400);

  console.log('\nPayment, move, cancel, refund');
  const pay = await call('POST', `/bookings/${booking.id}/payments`, { token: client.token });
  check('client starts an online payment', pay.status === 201 && pay.data.provider === 'mock', JSON.stringify(pay.data));
  check('reopening checkout reuses the open attempt', (await call('POST', `/bookings/${booking.id}/payments`, { token: client.token })).data.paymentId === pay.data.paymentId);
  check("someone else cannot confirm it (404)", (await call('POST', `/payments/${pay.data.paymentId}/mock-confirm`, { token: client2.token, body: { outcome: 'succeeded' } })).status === 404);
  await call('POST', `/payments/${pay.data.paymentId}/mock-confirm`, { token: client.token, body: { outcome: 'succeeded' } });
  check('booking becomes PAID', (await call('GET', `/bookings/${booking.id}`, { token: client.token })).data.paymentStatus === 'PAID');

  const second = all.slots.find((s) => s.startAt !== slot.startAt && Math.abs(new Date(s.startAt) - new Date(slot.startAt)) > 3 * 3_600_000) ?? (await firstSlot(kuba.id, offer.serviceId, 8)).slot;
  const moved = await call('PATCH', `/bookings/${booking.id}`, { token: client.token, body: { startAt: second.startAt } });
  check('client moves the booking; only the time changes', moved.status === 200 && moved.data.startAt === second.startAt && moved.data.priceSnapshot === booking.priceSnapshot && moved.data.barber.id === kuba.id, JSON.stringify(moved.data));
  const canceled = await call('POST', `/bookings/${booking.id}/cancel`, { token: client.token, body: { reason: 'smoke test' } });
  check('client cancels in time and the online payment is refunded', canceled.status === 200 && canceled.data.status === 'CANCELED' && canceled.data.paymentStatus === 'REFUNDED', JSON.stringify(canceled.data));
  check('a canceled booking is terminal (409)', (await call('POST', `/bookings/${booking.id}/cancel`, { token: admin.token, body: {} })).status === 409);
  check('the slot is free again', (await call('GET', `/barbers/${kuba.id}/slots?serviceId=${offer.serviceId}&date=${date}`)).data.slots.some((s) => s.startAt === slot.startAt));

  console.log('\nReception: phone bookings and claiming a record');
  const phone = `+4869${String(Date.now()).slice(-7)}`;
  const record = await call('POST', '/users/clients', { token: admin.token, body: { firstName: 'Walk-in', phoneNumber: phone } });
  check('admin creates a client record without a password', record.status === 201 && record.data.hasPassword === false);
  check('duplicate phone is 409', (await call('POST', '/users/clients', { token: admin.token, body: { firstName: 'Again', phoneNumber: phone } })).status === 409);
  const forClient = await call('POST', '/bookings', { token: admin.token, body: { barberId: kuba.id, serviceId: offer.serviceId, startAt: slot.startAt, clientId: record.data.id } });
  check('admin books on behalf of the client', forClient.status === 201 && forClient.data.client.id === record.data.id, JSON.stringify(forClient.data));
  const reg = { firstName: 'Walk', lastName: 'In', phoneNumber: phone, password: 'a-long-test-password' };
  const needCode = await call('POST', '/auth/register', { body: reg });
  check('registering on that phone demands proof of ownership', needCode.status === 409 && needCode.data.code === 'PHONE_VERIFICATION_REQUIRED');
  check('a wrong code is rejected', (await call('POST', '/auth/register', { body: { ...reg, code: '000000' === needCode.data.details.devCode ? '111111' : '000000' } })).status === 400);
  const claimed = await call('POST', '/auth/register', { body: { ...reg, code: needCode.data.details.devCode } });
  check('with the code the account is linked to the record', claimed.status === 201 && claimed.data.user.id === record.data.id);
  const history = await call('GET', '/bookings', { token: claimed.data.accessToken });
  check('the linked account sees the booking made for it', history.data.total === 1 && history.data.items[0].id === forClient.data.id);
  const closed = await call('POST', '/users/me/deactivate', { token: claimed.data.accessToken });
  check('deactivating the account cancels its upcoming bookings', closed.status === 200 && closed.data.canceledBookings === 1);
  check('a deactivated account is signed out at once', (await call('GET', '/users/me', { token: claimed.data.accessToken })).status === 401);

  console.log('\nStore');
  const products = (await call('GET', '/products?limit=50')).data.items;
  const product = products.find((p) => p.stock >= 5);
  const soldOut = products.find((p) => p.stock === 0);
  await call('DELETE', '/cart', { token: client.token });
  check('a sold-out product cannot be added (409)', (await call('PUT', `/cart/items/${soldOut.id}`, { token: client.token, body: { quantity: 1 } })).status === 409);
  const cart = await call('PUT', `/cart/items/${product.id}`, { token: client.token, body: { quantity: 2 } });
  check('cart totals add up', cart.status === 200 && cart.data.total === product.price * 2 && cart.data.canCheckout);
  const order = await call('POST', '/orders', { token: client.token, body: {} });
  check('order is placed from the cart', order.status === 201 && order.data.status === 'CREATED' && order.data.totalPrice === product.price * 2, JSON.stringify(order.data));
  check('the cart is emptied', (await call('GET', '/cart', { token: client.token })).data.items.length === 0);
  check('stock is decreased', (await call('GET', `/products/${product.id}`)).data.stock === product.stock - 2);
  check('an empty cart cannot be ordered (409)', (await call('POST', '/orders', { token: client.token, body: {} })).status === 409);
  check("someone else's order is 404", (await call('GET', `/orders/${order.data.id}`, { token: client2.token })).status === 404);
  check('clients cannot change order status (403)', (await call('PATCH', `/orders/${order.data.id}/status`, { token: client.token, body: { status: 'IN_PROGRESS' } })).status === 403);
  check('orders cannot skip a step (409)', (await call('PATCH', `/orders/${order.data.id}/status`, { token: admin.token, body: { status: 'READY' } })).status === 409);
  const orderPay = await call('POST', `/orders/${order.data.id}/payments`, { token: client.token });
  await call('POST', `/payments/${orderPay.data.paymentId}/mock-confirm`, { token: client.token, body: { outcome: 'succeeded' } });
  check('order becomes PAID', (await call('GET', `/orders/${order.data.id}`, { token: client.token })).data.paymentStatus === 'PAID');
  const orderCancel = await call('POST', `/orders/${order.data.id}/cancel`, { token: client.token });
  check('canceling refunds the order', orderCancel.status === 200 && orderCancel.data.status === 'CANCELED' && orderCancel.data.paymentStatus === 'REFUNDED', JSON.stringify(orderCancel.data));
  check('and restores the stock', (await call('GET', `/products/${product.id}`)).data.stock === product.stock);
  const big = await call('POST', '/orders', { token: admin.token, body: { clientId: client.user.id, items: [{ productId: product.id, quantity: 99 }] } });
  check('ordering more than the stock is 409', big.status === 409 && big.data.code === 'OUT_OF_STOCK');

  console.log('\nStaff and roles');
  check('admins cannot create staff (403)', (await call('POST', '/users/staff', { token: admin.token, body: { firstName: 'A', lastName: 'B', phoneNumber: '+48611111111', role: 'BARBER' } })).status === 403);
  const staffPhone = `+4868${String(Date.now()).slice(-7)}`;
  const staff = await call('POST', '/users/staff', { token: owner.token, body: { firstName: 'New', lastName: 'Barber', phoneNumber: staffPhone, role: 'BARBER' } });
  check('owner creates a barber and gets a one-time password link', staff.status === 201 && !!staff.data.user.barberId && staff.data.passwordLink.url.includes('/set-password?token='));
  const token = new URL(staff.data.passwordLink.url).searchParams.get('token');
  const set = await call('POST', '/auth/set-password', { body: { token, password: 'another-long-password' } });
  check('the new barber sets a password and is signed in', set.status === 200 && set.data.user.role === 'BARBER');
  check('the link works only once', (await call('POST', '/auth/set-password', { body: { token, password: 'another-long-password' } })).status === 400);
  check("the owner's role cannot be changed (409)", (await call('PATCH', `/users/${owner.user.id}/role`, { token: owner.token, body: { role: 'CLIENT' } })).status === 409);
  check('the owner cannot be deactivated (409)', (await call('POST', `/users/${owner.user.id}/deactivate`, { token: admin.token })).status === 409);
  check('a barber with upcoming bookings cannot be deactivated (409)', (await call('POST', `/users/${barber.user.id}/deactivate`, { token: admin.token })).status === 409);
  check('an admin cannot deactivate an admin (403)', (await call('POST', `/users/${admin.user.id}/deactivate`, { token: admin.token })).status === 403);
  check('owner deactivates the new barber', (await call('POST', `/users/${staff.data.user.id}/deactivate`, { token: owner.token })).status === 200);
  check('a deactivated barber leaves the public list', !(await call('GET', '/barbers')).data.some((b) => b.id === staff.data.user.barberId));

  console.log('\nReports');
  check('reports are owner-only (403 for admin)', (await call('GET', '/reports/summary', { token: admin.token })).status === 403);
  const summary = await call('GET', '/reports/summary', { token: owner.token });
  check('summary has revenue and a previous period', summary.status === 200 && summary.data.current.revenue > 0 && summary.data.previous.revenue > 0);
  const util = await call('GET', '/reports/barbers', { token: owner.token });
  check('utilisation is between 0 and 1', util.data.barbers.length >= 4 && util.data.barbers.every((b) => b.utilisation >= 0 && b.utilisation <= 1));
  check('revenue series is returned', (await call('GET', '/reports/revenue?groupBy=week', { token: owner.token })).data.series.length > 2);

  console.log('\nSessions');
  const refreshed = await call('POST', '/auth/refresh', { cookie: client.cookie });
  check('refresh rotates the token', refreshed.status === 200 && !!refreshed.data.accessToken && refreshed.cookie !== client.cookie);
  check('refresh without a cookie is 401', (await call('POST', '/auth/refresh')).status === 401);
  check('logout revokes the session', (await call('POST', '/auth/logout', { cookie: refreshed.cookie })).status === 204 && (await call('POST', '/auth/refresh', { cookie: refreshed.cookie })).status === 401);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
