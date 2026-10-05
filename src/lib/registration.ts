/**
 * Constants for the public registration form.
 *
 * A plain module because a "use server" file may only export async
 * functions, and both the form and the action need this list.
 */
export const BUSINESS_TYPES = [
  "Retailer", "Wholesaler", "Hardware store", "Contractor",
  "Manufacturer", "Distributor", "Other",
];
