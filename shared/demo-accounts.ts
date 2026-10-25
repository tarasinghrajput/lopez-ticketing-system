// Public, development-only fixtures. These are not Google, Razorpay, or production credentials.
export const demoAccounts = {
  ADMIN: {
    id: 'demo-admin',
    name: 'Alex Morgan',
    email: 'admin@lopez.test',
    password: 'LopezAdmin123!',
  },
  STAFF: {
    id: 'demo-staff',
    name: 'Jamie Parker',
    email: 'staff@lopez.test',
    password: 'LopezStaff123!',
  },
  CUSTOMER: {
    id: 'demo-customer',
    name: 'Sam Rivera',
    email: 'guest@lopez.test',
    password: 'LopezGuest123!',
  },
} as const;
