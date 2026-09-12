// Vercel entry point.
//
// An Express app is itself an (req, res) function, so Vercel's Node runtime can
// invoke it directly as a serverless handler. Routing every path here (see the
// rewrite in vercel.json) means the CORS allowlist, JSON parsing, request-id
// tagging and access logs in server.js all run in production — exactly as they
// do locally. Exposing api/chat.js as its own file-based function instead would
// bypass every one of those, which is the usual cause of "CORS error on Vercel".
export { default } from '../server.js';
