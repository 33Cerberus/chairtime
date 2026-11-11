/**
 * The shop's public details, shown in the header, footer and on the home page.
 * This is the one place to edit when the address, phone number or opening hours change.
 *
 * Opening hours here are what the footer says. What can actually be booked comes from each
 * barber's working hours, managed in the staff area.
 */
export const SHOP = {
  name: 'Chairtime',
  district: 'Śródmieście',
  address: 'ul. Mokotowska 41',
  city: '00-551 Warszawa',
  phone: '+48 22 555 01 41',
  email: 'hello@chairtime.pl',
  hours: [
    ['Mon – Fri', '9:00 – 20:00'],
    ['Saturday', '10:00 – 16:00'],
    ['Sunday', 'Closed'],
  ] as const,
  /** One line for the home page hero. */
  hoursShort: [
    ['Mon–Fri', '9–20'],
    ['Sat', '10–16'],
  ] as const,
};
