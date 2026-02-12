# ConnectVerse Security Checklist

This checklist provides a set of security best practices to follow when developing and deploying this application.

### 1. Firestore Security Rules
- [X] **Default Deny**: Rules should start with a `match /{document=**} { allow read, write: if false; }` to ensure no data is accessible by default. (The current rules implement this implicitly).
- [ ] **Review Regularly**: As you add new features, always review and update your `firestore.rules` file to ensure the principle of least privilege is maintained.
- [X] **Input Validation**: Use rule-level validation to check data types, formats, and required fields (e.g., `request.resource.data.status is string`).
- [X] **Ownership Checks**: Ensure users can only write to their own data, unless they are a host or admin (e.g., `allow update: if isOwner(userId);`).

### 2. Firebase App Check
- [ ] **Implement App Check**: In the Firebase Console, enable App Check for your project. This protects your backend resources (like Firestore and Auth) from abuse by ensuring that requests come from your genuine app. You will need to register your site's reCAPTCHA v3 token.

### 3. Application Security (Next.js)
- [X] **Secure Headers**: The `next.config.js` file has been configured to send important security headers like `Content-Security-Policy` and `X-Content-Type-Options` to prevent common attacks like XSS. Review and tighten the CSP as you add external resources.
- [X] **Input Validation**: All user input from forms and URLs is validated. The app uses `zod` for form validation and manual checks for URL parameters. Continue this practice for any new inputs.
- [ ] **Rate Limiting**: A basic middleware is in place for rate limiting. For production, integrate a robust service like `@upstash/ratelimit` within `src/middleware.ts` to prevent brute-force attacks on login or meeting creation endpoints.
- [ ] **CORS Configuration**: The `src/middleware.ts` file is the central place to manage Cross-Origin Resource Sharing if you add custom API endpoints. By default, client-side requests to Firebase are not affected by this.

### 4. Authentication & Authorization
- [X] **Strong Auth Rules**: Firebase Authentication is configured for email/password and anonymous login.
- [X] **Role-Based Access**: The app uses a `role` field on the `Participant` document and checks for `hostId` to implement role-based permissions (e.g., only the host can end the meeting or admit users).

### 5. Dependency Management
- [ ] **Audit Dependencies**: Regularly run `npm audit` to check for known vulnerabilities in your project's dependencies and apply patches as needed.
- [ ] **Keep Dependencies Updated**: Use a tool like Dependabot to automatically get notified of and update outdated packages.

### 6. Environment Variables
- [ ] **Never Commit Secrets**: Never commit private keys or sensitive API keys to your version control repository. Use environment variables (e.g., via `.env.local` for local development and configured secrets in your hosting provider) for all secrets. The Firebase client config is public and safe to commit.
