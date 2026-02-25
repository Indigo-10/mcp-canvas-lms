# Canvas MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants to Canvas LMS. Goes beyond listing files and assignments — it can **read your slides, PDFs, and course pages** so the AI can actually reason over your course content.

## What it does

- **Read course content** — extracts text from PDFs, PPTX, DOCX, HTML files, and Canvas pages
- **Bulk course dump** — walks all modules and pulls text from every file and page in one call
- **Search** — keyword search across files, pages, assignments, and discussions
- **Course timeline** — chronological map of every module, item, and due date (enables "everything before midterms" queries)
- **Full Canvas API** — 50+ tools covering courses, assignments, grades, submissions, quizzes, discussions, calendar, conversations, and admin

## Quick start

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["/path/to/mcp-canvas-lms/build/index.js"],
      "env": {
        "CANVAS_API_TOKEN": "your_token_here",
        "CANVAS_DOMAIN": "your_school.instructure.com"
      }
    }
  }
}
```

### From npm

```bash
npm install -g canvas-mcp-server
```

Then configure your MCP client to run `canvas-mcp-server` with the environment variables above.

### From source

```bash
git clone https://github.com/DMontgomery40/mcp-canvas-lms.git
cd mcp-canvas-lms
npm install
npm run build
```

## Getting your Canvas API token

1. Log into Canvas
2. Go to **Account** > **Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Give it a name, click **Generate Token**
6. Copy the token (you won't see it again)

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CANVAS_API_TOKEN` | Yes | — | Your Canvas API access token |
| `CANVAS_DOMAIN` | Yes | — | Your Canvas domain (e.g. `myschool.instructure.com`) |
| `CANVAS_ROLE` | No | `all` | Tool filtering: `student`, `instructor`, `admin`, or `all` |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` for Claude Desktop, `streamable-http` for web clients |
| `MCP_HTTP_PORT` | No | `3000` | Port for HTTP transport |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |

See `.env.example` for the full list.

## Tools

### Content extraction

| Tool | Description |
|------|-------------|
| `canvas_get_file_content` | Download a file and extract readable text. Supports PDF, DOCX, PPTX, HTML, plain text. Offset/limit params for chunked reading. |
| `canvas_get_course_content` | Bulk-extract text from all files and pages across a course's modules. Parallel downloads, date-range filtering, content-type filtering. |
| `canvas_get_assignment_content` | Get assignment instructions as clean text (HTML stripped). |

### Discovery and search

| Tool | Description |
|------|-------------|
| `canvas_search_course_content` | Keyword search across files, pages, assignments, and discussions. Runs searches in parallel. |
| `canvas_get_course_timeline` | Chronological map of all modules with items, due dates, and content types. |
| `canvas_get_todo_items` | Your Canvas todo list — what needs attention. |
| `canvas_get_unread_counts` | Unread activity summary across all courses. |
| `canvas_get_submission_feedback` | Structured grading feedback: score, comments, rubric assessment. |

### Course management

| Tool | Description |
|------|-------------|
| `canvas_list_courses` | List all courses |
| `canvas_get_course` | Get course details |
| `canvas_create_course` | Create a new course |
| `canvas_update_course` | Update course settings |
| `canvas_get_syllabus` | Get course syllabus |

### Assignments and grades

| Tool | Description |
|------|-------------|
| `canvas_list_assignments` | List assignments for a course |
| `canvas_get_assignment` | Get assignment details |
| `canvas_create_assignment` | Create an assignment |
| `canvas_update_assignment` | Update an assignment |
| `canvas_list_assignment_groups` | List assignment groups |
| `canvas_get_submission` | Get submission details |
| `canvas_submit_assignment` | Submit work for an assignment |
| `canvas_submit_grade` | Grade a submission (instructor) |
| `canvas_get_course_grades` | Get grades for a course |
| `canvas_get_user_grades` | Get all grades for current user |

### Modules

| Tool | Description |
|------|-------------|
| `canvas_list_modules` | List all modules |
| `canvas_get_module` | Get module details |
| `canvas_list_module_items` | List items in a module |
| `canvas_get_module_item` | Get a module item |
| `canvas_mark_module_item_complete` | Mark item complete |

### Files and pages

| Tool | Description |
|------|-------------|
| `canvas_list_files` | List files in a course or folder |
| `canvas_get_file` | Get file metadata |
| `canvas_list_folders` | List folders |
| `canvas_list_pages` | List pages |
| `canvas_get_page` | Get page content |

### Discussions and announcements

| Tool | Description |
|------|-------------|
| `canvas_list_discussion_topics` | List discussions |
| `canvas_get_discussion_topic` | Get discussion details |
| `canvas_post_to_discussion` | Post to a discussion |
| `canvas_list_announcements` | List announcements |

### Quizzes

| Tool | Description |
|------|-------------|
| `canvas_list_quizzes` | List quizzes |
| `canvas_get_quiz` | Get quiz details |
| `canvas_create_quiz` | Create a quiz |
| `canvas_start_quiz_attempt` | Start a quiz attempt |

### Calendar and dashboard

| Tool | Description |
|------|-------------|
| `canvas_list_calendar_events` | List calendar events |
| `canvas_get_upcoming_assignments` | Get upcoming due dates |
| `canvas_get_dashboard` | Get dashboard info |
| `canvas_get_dashboard_cards` | Get dashboard cards |

### Communication

| Tool | Description |
|------|-------------|
| `canvas_list_conversations` | List conversations |
| `canvas_get_conversation` | Get conversation details |
| `canvas_create_conversation` | Send a message |
| `canvas_list_notifications` | List notifications |

### User management

| Tool | Description |
|------|-------------|
| `canvas_get_user_profile` | Get your profile |
| `canvas_update_user_profile` | Update your profile |
| `canvas_enroll_user` | Enroll a user in a course |
| `canvas_list_rubrics` | List rubrics |
| `canvas_get_rubric` | Get rubric details |

### Account administration

| Tool | Description |
|------|-------------|
| `canvas_get_account` | Get account details |
| `canvas_list_account_courses` | List account courses |
| `canvas_list_account_users` | List account users |
| `canvas_create_user` | Create a user |
| `canvas_list_sub_accounts` | List sub-accounts |
| `canvas_get_account_reports` | List reports |
| `canvas_create_account_report` | Generate a report |

## Role filtering

Set `CANVAS_ROLE` to limit which tools are exposed:

- **`student`** — ~44 read-focused tools. No course creation, user management, or admin tools.
- **`all`** (default) — all 50+ tools including admin and write operations.

## HTTP transport

For web-based clients, set `MCP_TRANSPORT=streamable-http`:

```bash
CANVAS_API_TOKEN=xxx CANVAS_DOMAIN=xxx MCP_TRANSPORT=streamable-http node build/index.js
```

The server listens on `http://127.0.0.1:3000/mcp` by default. Configure with `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_PATH`.

## Docker

```bash
docker build -t canvas-mcp .
docker run --env-file .env canvas-mcp
```

Or with docker-compose:

```bash
docker-compose up -d
```

## Architecture

```
src/
  index.ts            MCP server, tool definitions, request handlers
  client.ts           Canvas API client with pagination, retry, caching
  text-extraction.ts  PDF/DOCX/PPTX/HTML text extraction
  types.ts            TypeScript type definitions
  declarations.d.ts   Type declarations for pdf-parse, officeparser
```

Key design decisions:
- **File download cache** — LRU cache (20 files, 5-min TTL) avoids re-downloading files during chunked reads
- **Parallel downloads** — `canvas_get_course_content` processes up to 5 items concurrently
- **Response size management** — automatic truncation to stay under MCP's 1 MB response limit
- **Structured errors** — every failure returns a typed error with `retryable`, `suggestion`, and `code` fields

## License

MIT
