// Clerk issues the JWTs the admin app sends. Set CLERK_JWT_ISSUER_DOMAIN on the
// deployment to the Clerk Frontend API URL, e.g. https://example.clerk.accounts.dev
// Until it's set there is no auth provider: the admin app can't sign in, but
// the functions still deploy, so the laptop, the dispatcher and
// `mom devices create` keep working.
const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;

const authConfig = {
  providers: domain ? [{ domain, applicationID: "convex" }] : [],
};

export default authConfig;
