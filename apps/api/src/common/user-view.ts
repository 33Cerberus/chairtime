import { BarberProfile, User } from '@prisma/client';

/** The account as returned by the API. Never includes the password hash. */
export function toUserView(user: User & { barberProfile?: Pick<BarberProfile, 'id'> | null }) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    phoneNumber: user.phoneNumber,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    /** False for client records created by an administrator that nobody has claimed yet. */
    hasPassword: !!user.passwordHash,
    barberId: user.role === 'BARBER' ? (user.barberProfile?.id ?? null) : null,
    createdAt: user.createdAt,
  };
}

export type UserView = ReturnType<typeof toUserView>;

export const fullName = (u: { firstName: string; lastName?: string | null }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ');
