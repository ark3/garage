// Identity lives behind exactly this one function. In production it will
// verify the Cf-Access-Jwt-Assertion JWT against the Access public keys.
// Locally it returns a stub.
export async function getUser(_request: Request): Promise<string> {
  return "dev@localhost";
}
