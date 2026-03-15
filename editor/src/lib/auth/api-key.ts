/**
 * Validate an API key from the Authorization header.
 * Supports: Bearer <key>
 * The key is checked against OCTUPOST_API_KEY env var.
 * Returns a user-like object for compatibility with existing code.
 */
export function validateApiKey(request: Request): {
  valid: boolean;
  userId?: string;
} {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { valid: false };

  const key = authHeader.slice(7);
  const expectedKey = process.env.OCTUPOST_API_KEY;

  if (!expectedKey || key !== expectedKey) return { valid: false };

  // API key maps to a specific user (the owner)
  const userId = process.env.OCTUPOST_API_USER_ID;
  if (!userId) return { valid: false };

  return { valid: true, userId };
}
