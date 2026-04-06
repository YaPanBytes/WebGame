export function getPilotToken() {
  // sessionStorage is tab-scoped:
  //  - Same tab refresh  → same token (session resumes where you were)
  //  - New tab / window  → brand new token (independent ship spawned)
  let token = sessionStorage.getItem('pilot_token');
  if (!token) {
    token = 'PILOT_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    sessionStorage.setItem('pilot_token', token);
  }
  return token;
}
