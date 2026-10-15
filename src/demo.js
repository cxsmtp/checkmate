// Realistic sample results in Checkmarx One /api/results shape, used when
// CX_MODE=demo so the booth works without a tenant (and for rehearsals).

const node = (fileName, line, name = '') => ({ fileName, line, column: 5, name });

export function demoResults() {
  return [
    // --- Fusion-only findings (logic / cross-file issues) ---
    {
      type: 'fusion', id: 'fus-001', similarityId: 'f1', severity: 'CRITICAL', state: 'TO_VERIFY', status: 'NEW',
      description: 'The order lookup endpoint loads an order by the id supplied in the URL and returns it without checking that the order belongs to the authenticated customer. Ownership is checked in the web controller for the list view but not in the API route that bypasses it.',
      data: { queryName: 'Broken object level authorization', engine: 'fusion', languageName: 'JavaScript', nodes: [node('src/api/orders.js', 42, 'getOrder'), node('src/services/orderService.js', 18, 'findById')] },
      vulnerabilityDetails: { cweId: 639 },
    },
    {
      type: 'fusion', id: 'fus-002', similarityId: 'f2', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'Coupon redemption reads the coupon, checks it has not been used, and then marks it used in a separate request to the database. Concurrent requests can redeem the same single-use coupon multiple times.',
      data: { queryName: 'Race condition in coupon redemption', engine: 'fusion', languageName: 'JavaScript', nodes: [node('src/services/couponService.js', 57, 'redeem')] },
      vulnerabilityDetails: { cweId: 367 },
    },
    {
      type: 'fusion', id: 'fus-003', similarityId: 'f3', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'The password reset token is verified for format and expiry, but the token is never bound to the user id it was issued for. A valid token for one account can be used to reset another account\'s password by changing the email parameter.',
      data: { queryName: 'Password reset token not bound to user', engine: 'fusion', languageName: 'JavaScript', nodes: [node('src/auth/reset.js', 88, 'resetPassword')] },
      vulnerabilityDetails: { cweId: 640 },
    },
    {
      type: 'fusion', id: 'fus-004', similarityId: 'f4', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'An admin-only middleware is registered after the /admin/export route, so the route is served before the authorization check runs.',
      data: { queryName: 'Middleware ordering bypasses admin authorization', engine: 'fusion', languageName: 'JavaScript', nodes: [node('src/app.js', 31, 'app.use')] },
      vulnerabilityDetails: { cweId: 862 },
    },
    // Fusion finding that the deterministic SAST engine also found (corroboration)
    {
      type: 'fusion', id: 'fus-005', similarityId: 'f5', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'User-controlled search term concatenated into SQL.',
      data: { queryName: 'SQL Injection', engine: 'fusion', languageName: 'JavaScript', nodes: [node('src/db/products.js', 23, 'query')] },
      vulnerabilityDetails: { cweId: 89 },
    },
    // --- Deterministic engines ---
    {
      type: 'sast', id: 'sast-001', similarityId: 's1', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'The application\'s search method receives user input from req.query.q, which is concatenated into an SQL statement executed at products.js line 24.',
      data: { queryName: 'SQL_Injection', languageName: 'JavaScript', nodes: [node('src/routes/search.js', 12, 'q'), node('src/db/products.js', 24, 'query')] },
      vulnerabilityDetails: { cweId: 89 },
    },
    {
      type: 'sast', id: 'sast-002', similarityId: 's2', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'User input from req.body.comment is rendered into the HTML page without encoding.',
      data: { queryName: 'Reflected_XSS', languageName: 'JavaScript', nodes: [node('src/views/review.js', 40, 'comment')] },
      vulnerabilityDetails: { cweId: 79 },
    },
    {
      type: 'sast', id: 'sast-003', similarityId: 's3', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'The filename parameter is used to build a path passed to fs.readFile.',
      data: { queryName: 'Path_Traversal', languageName: 'JavaScript', nodes: [node('src/routes/files.js', 15, 'filename')] },
      vulnerabilityDetails: { cweId: 22 },
    },
    {
      type: 'sast', id: 'sast-004', similarityId: 's4', severity: 'LOW', state: 'TO_VERIFY', status: 'NEW',
      description: 'crypto.createHash("md5") is used to hash user passwords.',
      data: { queryName: 'Use_Of_Broken_Or_Risky_Cryptographic_Algorithm', languageName: 'JavaScript', nodes: [node('src/auth/hash.js', 7, 'createHash')] },
      vulnerabilityDetails: { cweId: 327 },
    },
    {
      type: 'sca', id: 'CVE-2024-29041', similarityId: 'c1', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'Express.js open redirect in malformed URLs: versions prior to 4.19.2 allow an attacker to bypass allow-list checks when redirecting.',
      data: { packageIdentifier: 'Npm-express-4.17.1', recommendedVersion: '4.19.2' },
      vulnerabilityDetails: { cweId: 601, cveName: 'CVE-2024-29041', cvssScore: 6.1 },
    },
    {
      type: 'sca', id: 'CVE-2021-23337', similarityId: 'c2', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'Lodash versions prior to 4.17.21 are vulnerable to command injection via the template function.',
      data: { packageIdentifier: 'Npm-lodash-4.17.15', recommendedVersion: '4.17.21' },
      vulnerabilityDetails: { cweId: 94, cveName: 'CVE-2021-23337', cvssScore: 7.2 },
    },
    {
      type: 'kics', id: 'kics-001', similarityId: 'k1', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'S3 bucket allows public read access.',
      data: { queryName: 'S3 Bucket ACL Allows Read Access To All Users', platform: 'Terraform', filename: 'infra/storage.tf', line: 12, expectedValue: "acl should be 'private'", actualValue: "acl is 'public-read'" },
    },
    {
      type: 'kics', id: 'kics-002', similarityId: 'k2', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'Container runs as root user.',
      data: { queryName: 'Container Running As Root', platform: 'Dockerfile', filename: 'Dockerfile', line: 1, expectedValue: 'USER instruction with a non-root user', actualValue: 'No USER instruction' },
    },
    {
      type: 'sscs-secret-detection', id: 'sec-001', similarityId: 'x1', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'An AWS access key was found committed in a configuration file.',
      data: { ruleName: 'AWS Access Key', filename: 'config/default.json', line: 9 },
      vulnerabilityDetails: { cweId: 798 },
    },
  ];
}
