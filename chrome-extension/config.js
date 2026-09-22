// Same Supabase project as the Operations Library portal. The anon key is
// public by design (it's also in the portal's core/data.js); every call
// the extension makes is signed in as you.
export const SUPABASE_URL = 'https://kexnnpwjerrnsmifauuo.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtleG5ucHdqZXJybnNtaWZhdXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDcxNTEsImV4cCI6MjEwMzA4MzE1MX0.BAgC5wN4SKqfqKn0Gt7a53sGvigh_YlaMcQLdaovc08';
// Where "Open in OL" links go. Change if the portal's address differs.
export const PORTAL_URL = 'https://sphynxgithub.github.io/operations-library/';
// Remind you a timer is still running after this many idle minutes.
export const IDLE_REMINDER_MINUTES = 15;
