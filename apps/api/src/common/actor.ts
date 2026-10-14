/** Who is performing an action, for audit rows and maker-checker checks. */
export interface Actor {
  userId: string;
  role: string;
}
