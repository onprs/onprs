import { readFile, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME ?? "onprs";
const token = process.env.GITHUB_TOKEN;
const readmePath = new URL("../../README.md", import.meta.url);
const startMarker = "<!-- recent-activity:start -->";
const endMarker = "<!-- recent-activity:end -->";
const supportedTypes = new Set([
  "PushEvent",
  "PullRequestEvent",
  "IssuesEvent",
  "IssueCommentEvent",
  "CreateEvent",
  "ReleaseEvent",
]);

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${username}-profile-readme`,
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const response = await fetch(
  `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
  { headers },
);

if (!response.ok) {
  throw new Error(`GitHub API returned ${response.status} ${response.statusText}`);
}

const events = await response.json();
const profileRepository = `${username}/${username}`.toLowerCase();
const seenRepositories = new Set();
const recentEvents = [];

for (const event of events.sort(
  (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
)) {
  const repository = event.repo?.name;
  const repositoryKey = repository?.toLowerCase();

  if (
    !repository ||
    repositoryKey === profileRepository ||
    !supportedTypes.has(event.type) ||
    seenRepositories.has(repositoryKey)
  ) {
    continue;
  }

  seenRepositories.add(repositoryKey);
  recentEvents.push(event);

  if (recentEvents.length === 5) {
    break;
  }
}

if (recentEvents.length === 0) {
  throw new Error("GitHub API returned no supported public activity");
}

const readme = await readFile(readmePath, "utf8");
const startIndex = readme.indexOf(startMarker);
const endIndex = readme.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  throw new Error("Recent activity markers are missing or out of order");
}

const eol = readme.includes("\r\n") ? "\r\n" : "\n";
const activity = recentEvents.map(renderEvent).join(`${eol}${eol}`);
const allActivityUrl = `https://github.com/${encodeURIComponent(username)}?tab=overview`;
const block = [
  startMarker,
  activity,
  "",
  `<p><a href="${allActivityUrl}">View all activity</a></p>`,
  endMarker,
].join(eol);
const updatedReadme =
  readme.slice(0, startIndex) + block + readme.slice(endIndex + endMarker.length);

if (updatedReadme !== readme) {
  await writeFile(readmePath, updatedReadme, "utf8");
}

function renderEvent(event) {
  const { label, url } = describeEvent(event);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(event.created_at));

  return [
    "<p>",
    `  <a href="${escapeHtml(url)}"><b>${escapeHtml(label)}</b></a><br>`,
    `  <sub>${escapeHtml(date)}</sub>`,
    "</p>",
  ].join(eol);
}

function describeEvent(event) {
  const repository = event.repo.name;
  const repositoryUrl = `https://github.com/${repository}`;
  const [owner, name] = repository.split("/");
  const displayRepository =
    owner?.toLowerCase() === username.toLowerCase() ? name : repository;
  const action = capitalize(event.payload?.action ?? "updated");

  switch (event.type) {
    case "PushEvent": {
      const head = event.payload?.head;
      const url = /^[0-9a-f]{40}$/i.test(head ?? "")
        ? `${repositoryUrl}/commit/${head}`
        : repositoryUrl;
      return { label: `Pushed to ${displayRepository}`, url };
    }
    case "PullRequestEvent":
      return {
        label: `${action} a pull request in ${displayRepository}`,
        url: event.payload?.pull_request?.html_url ?? repositoryUrl,
      };
    case "IssuesEvent":
      return {
        label: `${action} an issue in ${displayRepository}`,
        url: event.payload?.issue?.html_url ?? repositoryUrl,
      };
    case "IssueCommentEvent": {
      const subject = event.payload?.issue?.pull_request
        ? "a pull request"
        : "an issue";
      return {
        label: `Commented on ${subject} in ${displayRepository}`,
        url:
          event.payload?.comment?.html_url ??
          event.payload?.issue?.html_url ??
          repositoryUrl,
      };
    }
    case "CreateEvent": {
      const referenceType = event.payload?.ref_type;
      const detail = referenceType
        ? `Created a ${referenceType} in`
        : "Created content in";
      return { label: `${detail} ${displayRepository}`, url: repositoryUrl };
    }
    case "ReleaseEvent":
      return {
        label: `${action} a release in ${displayRepository}`,
        url: event.payload?.release?.html_url ?? repositoryUrl,
      };
    default:
      return { label: `Updated ${displayRepository}`, url: repositoryUrl };
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
