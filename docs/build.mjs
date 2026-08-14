// Guestbook Serverless — AWS architecture (us-east-1, no VPC: all managed/global services).
// Adapted from examples/aws/build_pipeline.mjs — type "pipeline". Layout engine only: NO hardcoded coords.
import { writeFileSync } from "node:fs";
import { Diagram } from "/usr/local/lib/node_modules/drawio-ai-kit/src/builder.mjs";
import { group, frame, icon, box, stage, band, endpoint, phantom, renderTree } from "/usr/local/lib/node_modules/drawio-ai-kit/src/layout-engine.mjs";

const d = new Diagram("pipeline");

// ---------- synchronous request path (client waits only for this) ----------
const edge = stage("s_edge", 0, "Frontend & API (synchronous)", [
  icon("amplify", "amplify", "Amplify Hosting\n(Next.js frontend)"),
  icon("apigw", "api_gateway", "API Gateway (REST)\nstage: prod · CORS"),
]);
const compute = stage("s_compute", 1, "Sync compute", [
  icon("l_submit", "lambda", "guestbook-lambda-\nsubmitform"),
  icon("l_get", "lambda", "guestbook-lambda-\ngetsubmissions"),
]);
const data = stage("s_data", 2, "Data store", [
  icon("ddb", "dynamodb", "guestbook-dynamodb-entries\npk: submissionId · PAY_PER_REQUEST"),
  icon("ddbstream", "dynamodb_stream", "DynamoDB Streams\nNEW_IMAGE"),
]);

const syncRow = phantom("syncrow", "", { dir: "row", gap: 56, align: "top", header: 0 }, [
  edge, compute, data,
]);

// ---------- asynchronous notification pipeline (client does NOT wait) ----------
const aProcess = stage("a_proc", 0, "Stream → Queue", [
  icon("l_stream", "lambda", "guestbook-lambda-\nstreamprocessor\nBatchSize 10 · LATEST"),
  icon("sqs", "sqs", "guestbook-sqs-notification\nVisibilityTimeout 180"),
]);
const aSend = stage("a_send", 1, "Notify (idempotent)", [
  icon("l_sender", "lambda", "guestbook-lambda-sender\nBatchSize 1 · idempotent"),
  icon("ssm", "systems_manager", "SSM Parameter Store\n/guestbook/*"),
]);
const aDeliver = stage("a_deliver", 2, "Delivery", [
  icon("ses", "simple_email_service", "SES SendTemplatedEmail\nGuestbookConfirmation"),
  icon("sns", "sns", "guestbook-sns-admin"),
]);

const asyncFrame = frame("async", "ASYNCHRONOUS NOTIFICATION PIPELINE — runs after the API response, client does NOT wait", { dir: "row", gap: 48, align: "top" }, [
  aProcess, aSend, aDeliver,
]);

// ---------- reliability / monitoring band ----------
const reliability = band("rel", "Reliability & monitoring", [
  icon("dlq", "sqs", "guestbook-sqs-\nnotification-dlq"),
  icon("alarm", "cloudwatch_2", "CloudWatch alarm\nguestbook-dlq-messages-alarm"),
  box("syncnote", "SYNC BOUNDARY\nAPI returns 200 OK right after PutItem —\nemail/admin notification happen asynchronously.", { fill: "#f8cecc", stroke: "#b85450", fs: 11 }),
]);

const region = group("region", "group_region", "Region: us-east-1", { dir: "col", gap: 34 }, [
  syncRow, asyncFrame, reliability,
]);
const cloud = group("aws", "group_aws_cloud_alt", "AWS Cloud", { dir: "col", gap: 24 }, [region]);

const tree = phantom("root", "", { dir: "row", gap: 56, align: "center", header: 0, pad: 10 }, [
  endpoint("guest", "GUEST USER\n\nBrowser\n· event-registration form"),
  cloud,
  phantom("outs", "", { dir: "col", gap: 60, header: 0 }, [
    endpoint("mail", "GUEST INBOX\n\nconfirmation email"),
    endpoint("admin", "ADMIN\n\nnew-registration\nnotification"),
  ]),
]);

renderTree(d, tree, [40, 80]);
d.title("Guestbook Serverless — event registration on AWS (us-east-1) · synchronous API + asynchronous notification pipeline");

// synchronous path (spine, numbered)
d.link("guest", "amplify", "HTTPS: load Next.js app");
d.link("guest", "apigw", "sync REST call (CORS)", { step: 1, flow: true });
d.link("apigw", "l_submit", "POST /submit", { step: 2 });
d.link("l_submit", "ddb", "PutItem", { step: 3 });
d.link("apigw", "l_get", "GET /submissions", { role: "fanout" });
d.link("l_get", "ddb", "Scan", { role: "fanout" });

// asynchronous pipeline
d.link("ddb", "ddbstream", "stream NEW_IMAGE");
d.link("ddbstream", "l_stream", "trigger (BatchSize 10)", { step: 4 });
d.link("l_stream", "sqs", "SendMessage", { step: 5 });
d.link("sqs", "l_sender", "trigger (BatchSize 1)", { step: 6 });
d.link("l_sender", "ssm", "GetParameter", { dash: true });
d.link("l_sender", "ses", "SendTemplatedEmail", { step: 7 });
d.link("l_sender", "sns", "Publish", { step: 8 });
d.link("ses", "mail", "confirmation email");
d.link("sns", "admin", "admin notification");

// reliability
d.link("sqs", "dlq", "redrive after 3 retries", { dash: true });
d.link("dlq", "alarm", "MessagesVisible > 0", { dash: true });
d.link("alarm", "sns", "alarm → SNS", { dash: true });

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(new URL("./architecture.drawio", import.meta.url), d.mxfile("Guestbook Serverless architecture"));

// Self-check tail (from `drawio-ai scaffold`): one run = build + validate + render + issues.
import { execFileSync as __exec } from "node:child_process";
try {
  const __f = new URL("./architecture.drawio", import.meta.url).pathname;
  console.log(__exec("drawio-ai", ["render", __f, "--check", "-o", new URL("./architecture.png", import.meta.url).pathname], { encoding: "utf8" }).trim());
} catch (e) { console.error("RENDER-SKIPPED:", String(e.message).split("\n")[0]); }
