#!/usr/bin/env node

// src/index.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { CanvasClient } from "./client.js";
import { detectContentType, extractText, stripHtml } from "./text-extraction.js";
import {
  CreateCourseArgs,
  UpdateCourseArgs,
  CreateAssignmentArgs,
  UpdateAssignmentArgs,
  SubmitGradeArgs,
  EnrollUserArgs,
  CanvasCourse,
  CanvasAssignmentSubmission,
  SubmitAssignmentArgs,
  FileUploadArgs,
  MCPServerConfig,
  CreateUserArgs,
  ListAccountCoursesArgs,
  ListAccountUsersArgs,
  CreateReportArgs,
  CanvasAPIError
} from "./types.js";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { type Readable, type Writable } from "node:stream";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

const RAW_TOOLS: Tool[] = [
  // Health and system tools
  {
    name: "canvas_health_check",
    description: "Check the health and connectivity of the Canvas API",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Course management
  {
    name: "canvas_list_courses",
    description: "List all courses for the current user",
    inputSchema: {
      type: "object",
      properties: {
        include_ended: { type: "boolean", description: "Include ended courses" }
      },
      required: []
    }
  },
  {
    name: "canvas_get_course",
    description: "Get detailed information about a specific course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_create_course",
    description: "Create a new course in Canvas",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account to create the course in" },
        name: { type: "string", description: "Name of the course" },
        course_code: { type: "string", description: "Course code (e.g., CS101)" },
        start_at: { type: "string", description: "Course start date (ISO format)" },
        end_at: { type: "string", description: "Course end date (ISO format)" },
        license: { type: "string", description: "Course license" },
        is_public: { type: "boolean", description: "Whether the course is public" },
        is_public_to_auth_users: { type: "boolean", description: "Whether the course is public to authenticated users" },
        public_syllabus: { type: "boolean", description: "Whether the syllabus is public" },
        public_syllabus_to_auth: { type: "boolean", description: "Whether the syllabus is public to authenticated users" },
        public_description: { type: "string", description: "Public description of the course" },
        allow_student_wiki_edits: { type: "boolean", description: "Whether students can edit the wiki" },
        allow_wiki_comments: { type: "boolean", description: "Whether wiki comments are allowed" },
        allow_student_forum_attachments: { type: "boolean", description: "Whether students can add forum attachments" },
        open_enrollment: { type: "boolean", description: "Whether the course has open enrollment" },
        self_enrollment: { type: "boolean", description: "Whether the course allows self enrollment" },
        restrict_enrollments_to_course_dates: { type: "boolean", description: "Whether to restrict enrollments to course start/end dates" },
        term_id: { type: "number", description: "ID of the enrollment term" },
        sis_course_id: { type: "string", description: "SIS course ID" },
        integration_id: { type: "string", description: "Integration ID for the course" },
        hide_final_grades: { type: "boolean", description: "Whether to hide final grades" },
        apply_assignment_group_weights: { type: "boolean", description: "Whether to apply assignment group weights" },
        time_zone: { type: "string", description: "Course time zone" },
        syllabus_body: { type: "string", description: "Course syllabus content" }
      },
      required: ["account_id", "name"]
    }
  },
  {
    name: "canvas_update_course",
    description: "Update an existing course in Canvas",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course to update" },
        name: { type: "string", description: "New name for the course" },
        course_code: { type: "string", description: "New course code" },
        start_at: { type: "string", description: "New start date (ISO format)" },
        end_at: { type: "string", description: "New end date (ISO format)" },
        license: { type: "string", description: "Course license" },
        is_public: { type: "boolean", description: "Whether the course is public" },
        is_public_to_auth_users: { type: "boolean", description: "Whether the course is public to authenticated users" },
        public_syllabus: { type: "boolean", description: "Whether the syllabus is public" },
        public_syllabus_to_auth: { type: "boolean", description: "Whether the syllabus is public to authenticated users" },
        public_description: { type: "string", description: "Public description of the course" },
        allow_student_wiki_edits: { type: "boolean", description: "Whether students can edit the wiki" },
        allow_wiki_comments: { type: "boolean", description: "Whether wiki comments are allowed" },
        allow_student_forum_attachments: { type: "boolean", description: "Whether students can add forum attachments" },
        open_enrollment: { type: "boolean", description: "Whether the course has open enrollment" },
        self_enrollment: { type: "boolean", description: "Whether the course allows self enrollment" },
        restrict_enrollments_to_course_dates: { type: "boolean", description: "Whether to restrict enrollments to course start/end dates" },
        hide_final_grades: { type: "boolean", description: "Whether to hide final grades" },
        apply_assignment_group_weights: { type: "boolean", description: "Whether to apply assignment group weights" },
        time_zone: { type: "string", description: "Course time zone" },
        syllabus_body: { type: "string", description: "Updated syllabus content" }
      },
      required: ["course_id"]
    }
  },

  // Assignment management
  {
    name: "canvas_list_assignments",
    description: "List assignments for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        include_submissions: { type: "boolean", description: "Include submission data" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_assignment",
    description: "Get detailed information about a specific assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        include_submission: { type: "boolean", description: "Include user's submission data" }
      },
      required: ["course_id", "assignment_id"]
    }
  },
  {
    name: "canvas_create_assignment",
    description: "Create a new assignment in a Canvas course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        name: { type: "string", description: "Name of the assignment" },
        description: { type: "string", description: "Assignment description/instructions" },
        due_at: { type: "string", description: "Due date (ISO format)" },
        points_possible: { type: "number", description: "Maximum points possible" },
        submission_types: { 
          type: "array", 
          items: { type: "string" },
          description: "Allowed submission types"
        },
        allowed_extensions: {
          type: "array",
          items: { type: "string" },
          description: "Allowed file extensions for submissions"
        },
        published: { type: "boolean", description: "Whether the assignment is published" }
      },
      required: ["course_id", "name"]
    }
  },
  {
    name: "canvas_update_assignment",
    description: "Update an existing assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment to update" },
        name: { type: "string", description: "New name for the assignment" },
        description: { type: "string", description: "New assignment description" },
        due_at: { type: "string", description: "New due date (ISO format)" },
        points_possible: { type: "number", description: "New maximum points" },
        published: { type: "boolean", description: "Whether the assignment is published" }
      },
      required: ["course_id", "assignment_id"]
    }
  },

  // Assignment groups
  {
    name: "canvas_list_assignment_groups",
    description: "List assignment groups for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Submissions and grading
  {
    name: "canvas_get_submission",
    description: "Get submission details for an assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        user_id: { type: "number", description: "ID of the user (optional, defaults to self)" }
      },
      required: ["course_id", "assignment_id"]
    }
  },
  {
    name: "canvas_submit_assignment",
    description: "Submit work for an assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        submission_type: { 
          type: "string", 
          enum: ["online_text_entry", "online_url", "online_upload"],
          description: "Type of submission" 
        },
        body: { type: "string", description: "Text content for text submissions" },
        url: { type: "string", description: "URL for URL submissions" },
        file_ids: { 
          type: "array", 
          items: { type: "number" },
          description: "File IDs for file submissions" 
        }
      },
      required: ["course_id", "assignment_id", "submission_type"]
    }
  },
  {
    name: "canvas_submit_grade",
    description: "Submit a grade for a student's assignment (teacher only)",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        user_id: { type: "number", description: "ID of the student" },
        grade: { 
          oneOf: [
            { type: "number" },
            { type: "string" }
          ],
          description: "Grade to submit (number or letter grade)"
        },
        comment: { type: "string", description: "Optional comment on the submission" }
      },
      required: ["course_id", "assignment_id", "user_id", "grade"]
    }
  },

  // Files and uploads
  {
    name: "canvas_list_files",
    description: "List files in a course or folder",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        folder_id: { type: "number", description: "ID of the folder (optional)" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_file",
    description: "Get information about a specific file",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "number", description: "ID of the file" }
      },
      required: ["file_id"]
    }
  },
  {
    name: "canvas_get_file_content",
    description: "Download a file from Canvas by file ID, extract its readable text, and return it. Supports PDF, DOCX, PPTX, HTML, and plain text. Use offset/limit for chunked reading of large documents.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "number", description: "ID of the file to download and extract text from" },
        offset: { type: "number", description: "Character offset to start reading from (default: 0)" },
        limit: { type: "number", description: "Maximum number of characters to return (default: all)" }
      },
      required: ["file_id"]
    }
  },
  {
    name: "canvas_get_course_content",
    description: "Bulk-extract readable text from all files and pages across a course's modules. Downloads files in parallel for speed. Optionally filter by module_id, content_type, or date range. Supports 'before midterms' style queries when combined with canvas_get_course_timeline.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "Only process items from this specific module" },
        content_type: {
          type: "string",
          enum: ["pdf", "docx", "pptx", "html", "page", "text", "all"],
          description: "Filter by content type. 'page' = Canvas pages only, 'all' = everything (default: all)"
        },
        max_items: { type: "number", description: "Maximum number of content items to process (default: 50, max: 200)" },
        before_date: { type: "string", description: "Only include items due/unlocked before this ISO date" },
        after_date: { type: "string", description: "Only include items due/unlocked after this ISO date" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_list_folders",
    description: "List folders in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Pages
  {
    name: "canvas_list_pages",
    description: "List pages in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_page",
    description: "Get content of a specific page",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        page_url: { type: "string", description: "URL slug of the page" }
      },
      required: ["course_id", "page_url"]
    }
  },

  // Calendar and due dates
  {
    name: "canvas_list_calendar_events",
    description: "List calendar events",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO format)" },
        end_date: { type: "string", description: "End date (ISO format)" }
      },
      required: []
    }
  },
  {
    name: "canvas_get_upcoming_assignments",
    description: "Get upcoming assignment due dates",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of assignments to return" }
      },
      required: []
    }
  },

  // Dashboard
  {
    name: "canvas_get_dashboard",
    description: "Get user's dashboard information",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "canvas_get_dashboard_cards",
    description: "Get dashboard course cards",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Grades
  {
    name: "canvas_get_course_grades",
    description: "Get grades for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_user_grades",
    description: "Get all grades for the current user",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // User management
  {
    name: "canvas_get_user_profile",
    description: "Get current user's profile",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "canvas_update_user_profile",
    description: "Update current user's profile",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "User's name" },
        short_name: { type: "string", description: "User's short name" },
        bio: { type: "string", description: "User's bio" },
        title: { type: "string", description: "User's title" },
        time_zone: { type: "string", description: "User's time zone" }
      },
      required: []
    }
  },
  {
    name: "canvas_enroll_user",
    description: "Enroll a user in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        user_id: { type: "number", description: "ID of the user to enroll" },
        role: { 
          type: "string", 
          description: "Role for the enrollment (StudentEnrollment, TeacherEnrollment, etc.)" 
        },
        enrollment_state: { 
          type: "string",
          description: "State of the enrollment (active, invited, etc.)"
        }
      },
      required: ["course_id", "user_id"]
    }
  },

  // Modules
  {
    name: "canvas_list_modules",
    description: "List all modules in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_module",
    description: "Get details of a specific module",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" }
      },
      required: ["course_id", "module_id"]
    }
  },
  {
    name: "canvas_list_module_items",
    description: "List all items in a module",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" }
      },
      required: ["course_id", "module_id"]
    }
  },
  {
    name: "canvas_get_module_item",
    description: "Get details of a specific module item",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" },
        item_id: { type: "number", description: "ID of the module item" }
      },
      required: ["course_id", "module_id", "item_id"]
    }
  },
  {
    name: "canvas_mark_module_item_complete",
    description: "Mark a module item as complete",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" },
        item_id: { type: "number", description: "ID of the module item" }
      },
      required: ["course_id", "module_id", "item_id"]
    }
  },

  // Discussions
  {
    name: "canvas_list_discussion_topics",
    description: "List all discussion topics in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_discussion_topic",
    description: "Get details of a specific discussion topic",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        topic_id: { type: "number", description: "ID of the discussion topic" }
      },
      required: ["course_id", "topic_id"]
    }
  },
  {
    name: "canvas_post_to_discussion",
    description: "Post a message to a discussion topic",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        topic_id: { type: "number", description: "ID of the discussion topic" },
        message: { type: "string", description: "Message content" }
      },
      required: ["course_id", "topic_id", "message"]
    }
  },

  // Announcements
  {
    name: "canvas_list_announcements",
    description: "List all announcements in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Quizzes
  {
    name: "canvas_list_quizzes",
    description: "List all quizzes in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_quiz",
    description: "Get details of a specific quiz",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        quiz_id: { type: "number", description: "ID of the quiz" }
      },
      required: ["course_id", "quiz_id"]
    }
  },
  {
    name: "canvas_create_quiz",
    description: "Create a new quiz in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        title: { type: "string", description: "Title of the quiz" },
        quiz_type: { type: "string", description: "Type of the quiz (e.g., graded)" },
        time_limit: { type: "number", description: "Time limit in minutes" },
        published: { type: "boolean", description: "Is the quiz published" },
        description: { type: "string", description: "Description of the quiz" },
        due_at: { type: "string", description: "Due date (ISO format)" }
      },
      required: ["course_id", "title"]
    }
  },
  {
    name: "canvas_start_quiz_attempt",
    description: "Start a new quiz attempt",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        quiz_id: { type: "number", description: "ID of the quiz" }
      },
      required: ["course_id", "quiz_id"]
    }
  },

  // Rubrics
  {
    name: "canvas_list_rubrics",
    description: "List rubrics for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_rubric",
    description: "Get details of a specific rubric",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        rubric_id: { type: "number", description: "ID of the rubric" }
      },
      required: ["course_id", "rubric_id"]
    }
  },

  // Conversations
  {
    name: "canvas_list_conversations",
    description: "List user's conversations",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "canvas_get_conversation",
    description: "Get details of a specific conversation",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "number", description: "ID of the conversation" }
      },
      required: ["conversation_id"]
    }
  },
  {
    name: "canvas_create_conversation",
    description: "Create a new conversation",
    inputSchema: {
      type: "object",
      properties: {
        recipients: { 
          type: "array", 
          items: { type: "string" },
          description: "Recipient user IDs or email addresses" 
        },
        body: { type: "string", description: "Message body" },
        subject: { type: "string", description: "Message subject" }
      },
      required: ["recipients", "body"]
    }
  },

  // Notifications
  {
    name: "canvas_list_notifications",
    description: "List user's notifications",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Syllabus
  {
    name: "canvas_get_syllabus",
    description: "Get course syllabus",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Search
  {
    name: "canvas_search_course_content",
    description: "Search across a course's files, pages, assignments, and discussions by keyword. Returns matching items with types and locations. Runs searches in parallel for speed.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        search_term: { type: "string", description: "Keyword or phrase to search for" },
        content_types: {
          type: "array",
          items: { type: "string", enum: ["files", "pages", "assignments", "discussions"] },
          description: "Which content types to search (default: all four)"
        }
      },
      required: ["course_id", "search_term"]
    }
  },

  // Course timeline
  {
    name: "canvas_get_course_timeline",
    description: "Get a chronological map of a course: all modules in order with their items, due dates, unlock dates, and content types. Essential for understanding course structure and answering questions like 'what's due before midterms'.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Assignment content extraction
  {
    name: "canvas_get_assignment_content",
    description: "Get the full text content of an assignment's instructions/description with HTML stripped to clean readable text, plus key metadata like due date, points, and submission types.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" }
      },
      required: ["course_id", "assignment_id"]
    }
  },

  // Submission feedback
  {
    name: "canvas_get_submission_feedback",
    description: "Get structured feedback for a submission: grade, score, instructor comments, rubric assessment, and late/missing status. Defaults to the current user's submission.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        user_id: { type: "number", description: "User ID (defaults to self)" }
      },
      required: ["course_id", "assignment_id"]
    }
  },

  // Todo items
  {
    name: "canvas_get_todo_items",
    description: "Get the current user's Canvas todo list — items needing attention like unsubmitted assignments, upcoming due dates, and ungraded work.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Unread counts / activity summary
  {
    name: "canvas_get_unread_counts",
    description: "Get a summary of unread activity across all courses — unread discussions, messages, submissions needing attention, and other notifications.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Account Management
  {
    name: "canvas_get_account",
    description: "Get account details",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "canvas_list_account_courses",
    description: "List courses for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account" },
        with_enrollments: { type: "boolean", description: "Include enrollment data" },
        published: { type: "boolean", description: "Only include published courses" },
        completed: { type: "boolean", description: "Include completed courses" },
        search_term: { type: "string", description: "Search term to filter courses" },
        sort: { type: "string", enum: ["course_name", "sis_course_id", "teacher", "account_name"], description: "Sort order" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort direction" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "canvas_list_account_users",
    description: "List users for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account" },
        search_term: { type: "string", description: "Search term to filter users" },
        sort: { type: "string", enum: ["username", "email", "sis_id", "last_login"], description: "Sort order" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort direction" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "canvas_create_user",
    description: "Create a new user in an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account" },
        user: {
          type: "object",
          properties: {
            name: { type: "string", description: "Full name of the user" },
            short_name: { type: "string", description: "Short name of the user" },
            sortable_name: { type: "string", description: "Sortable name (Last, First)" },
            time_zone: { type: "string", description: "User's time zone" }
          },
          required: ["name"]
        },
        pseudonym: {
          type: "object",
          properties: {
            unique_id: { type: "string", description: "Unique login ID (email or username)" },
            password: { type: "string", description: "User's password" },
            sis_user_id: { type: "string", description: "SIS ID for the user" },
            send_confirmation: { type: "boolean", description: "Send confirmation email" }
          },
          required: ["unique_id"]
        }
      },
      required: ["account_id", "user", "pseudonym"]
    }
  },
  {
    name: "canvas_list_sub_accounts",
    description: "List sub-accounts for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the parent account" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "canvas_get_account_reports",
    description: "List available reports for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "canvas_create_account_report",
    description: "Generate a report for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "number", description: "ID of the account" },
        report: { type: "string", description: "Type of report to generate" },
        parameters: { type: "object", description: "Report parameters" }
      },
      required: ["account_id", "report"]
    }
  }
];

type StructuredToolError = {
  status: "error";
  retryable: boolean;
  suggestion: string;
  message: string;
  code: "validation_error" | "canvas_api_error" | "unknown_tool" | "internal_error";
  tool: string;
};

type StreamableHttpRuntime = {
  transport: StreamableHTTPServerTransport;
  httpServer: HttpServer;
};

const READ_ONLY_TOOL_PREFIXES = ["canvas_list_", "canvas_get_", "canvas_search_", "canvas_health_check"] as const;
const MUTATING_TOOL_PREFIXES = [
  "canvas_create_",
  "canvas_update_",
  "canvas_submit_",
  "canvas_enroll_",
  "canvas_mark_",
  "canvas_post_",
  "canvas_start_"
] as const;

function toCommaList(values: string[]): string {
  if (values.length === 0) {
    return "none";
  }

  return values.join(", ");
}

function getInputSchema(tool: Tool): Record<string, unknown> {
  return (tool.inputSchema as Record<string, unknown> | undefined) ?? {};
}

function getRequiredFields(tool: Tool): string[] {
  const schema = getInputSchema(tool);
  const required = schema.required;
  return Array.isArray(required) ? required.filter((value): value is string => typeof value === "string") : [];
}

function getDefaultFields(tool: Tool): string[] {
  const schema = getInputSchema(tool);
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) {
    return [];
  }

  return Object.entries(properties)
    .filter(([, property]) => {
      if (!property || typeof property !== "object") {
        return false;
      }
      return Object.prototype.hasOwnProperty.call(property, "default");
    })
    .map(([name]) => name);
}

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isMutatingTool(name: string): boolean {
  return MUTATING_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function optimizeToolDescription(tool: Tool): string {
  const required = getRequiredFields(tool);
  const defaults = getDefaultFields(tool);
  const sideEffect = isReadOnlyTool(tool.name)
    ? "No Canvas state is modified."
    : "This operation can modify Canvas state.";
  const latencyHint = isReadOnlyTool(tool.name)
    ? "Latency depends on Canvas API response time."
    : "May incur extra latency due to writes and Canvas-side processing.";

  return [
    tool.description ?? "Canvas LMS tool",
    `Required fields: ${toCommaList(required)}.`,
    `Defaults: ${defaults.length > 0 ? defaults.join(", ") : "none"}.`,
    sideEffect,
    latencyHint,
    "Use include_raw=true only when full provider payload is required."
  ].join(" ");
}

function optimizeToolAnnotations(toolName: string): Tool["annotations"] {
  if (isReadOnlyTool(toolName)) {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    };
  }

  if (isMutatingTool(toolName)) {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    };
  }

  return {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true
  };
}

function optimizeToolInputSchema(tool: Tool): Tool["inputSchema"] {
  const schema = getInputSchema(tool);
  const properties =
    (schema.properties as Record<string, unknown> | undefined) ??
    {};
  const required =
    (schema.required as string[] | undefined) ??
    [];

  const optimizedProperties: Record<string, unknown> = {
    ...properties
  };

  if (!Object.prototype.hasOwnProperty.call(optimizedProperties, "include_raw")) {
    optimizedProperties.include_raw = {
      type: "boolean",
      default: false,
      description: "When true, return full raw Canvas API payload for this tool call."
    };
  }

  return {
    type: "object",
    ...schema,
    properties: optimizedProperties,
    required
  } as Tool["inputSchema"];
}

const ALL_TOOLS: Tool[] = RAW_TOOLS.map((tool) => ({
  ...tool,
  description: optimizeToolDescription(tool),
  inputSchema: optimizeToolInputSchema(tool),
  annotations: optimizeToolAnnotations(tool.name)
}));

const STUDENT_TOOL_NAMES = new Set([
  "canvas_health_check",
  "canvas_list_courses",
  "canvas_get_course",
  "canvas_list_assignments",
  "canvas_get_assignment",
  "canvas_get_submission",
  "canvas_submit_assignment",
  "canvas_list_modules",
  "canvas_get_module",
  "canvas_list_module_items",
  "canvas_get_module_item",
  "canvas_mark_module_item_complete",
  "canvas_list_files",
  "canvas_get_file",
  "canvas_get_file_content",
  "canvas_get_course_content",
  "canvas_list_folders",
  "canvas_list_pages",
  "canvas_get_page",
  "canvas_search_course_content",
  "canvas_get_course_timeline",
  "canvas_get_assignment_content",
  "canvas_get_submission_feedback",
  "canvas_get_todo_items",
  "canvas_get_unread_counts",
  "canvas_list_discussion_topics",
  "canvas_get_discussion_topic",
  "canvas_post_to_discussion",
  "canvas_list_announcements",
  "canvas_get_course_grades",
  "canvas_get_user_grades",
  "canvas_get_user_profile",
  "canvas_list_calendar_events",
  "canvas_get_upcoming_assignments",
  "canvas_get_dashboard",
  "canvas_get_dashboard_cards",
  "canvas_list_quizzes",
  "canvas_get_quiz",
  "canvas_start_quiz_attempt",
  "canvas_list_conversations",
  "canvas_get_conversation",
  "canvas_create_conversation",
  "canvas_list_notifications",
  "canvas_get_syllabus",
  "canvas_list_rubrics",
  "canvas_get_rubric"
]);

function getToolsForRole(role: string): Tool[] {
  if (role === "student") {
    return ALL_TOOLS.filter((tool) => STUDENT_TOOL_NAMES.has(tool.name));
  }
  return ALL_TOOLS;
}

export class CanvasMCPServer {
  private readonly server: Server;
  private readonly client: CanvasClient;
  private readonly config: MCPServerConfig;
  private readonly tools: Tool[];
  private streamableHttpRuntime: StreamableHttpRuntime | undefined;

  constructor(config: MCPServerConfig, client?: CanvasClient) {
    this.config = config;
    this.tools = getToolsForRole(config.role ?? "all");
    this.client = client ?? new CanvasClient(
      config.canvas.token,
      config.canvas.domain,
      {
        maxRetries: config.canvas.maxRetries,
        retryDelay: config.canvas.retryDelay
      }
    );

    this.server = new Server(
      {
        name: config.name,
        version: config.version
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error(`[${this.config.name} Error]`, error);
    };
  }

  private static readonly MAX_RESPONSE_BYTES = 900_000; // 900 KB, under Claude's 1 MB MCP limit

  private static readonly HEAVY_FIELDS = ["body", "description", "message", "syllabus_body", "html_url", "preview_url"];

  private stripHeavyFields(obj: Record<string, unknown>): Record<string, unknown> {
    const stripped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (CanvasMCPServer.HEAVY_FIELDS.includes(key) && typeof value === "string" && value.length > 500) {
        stripped[key] = (value as string).slice(0, 500) + "... [truncated]";
      } else {
        stripped[key] = value;
      }
    }
    return stripped;
  }

  private serializeToolOutput(payload: unknown, includeRaw: boolean): string {
    if (payload === null || payload === undefined) {
      return JSON.stringify({ result: null });
    }

    if (includeRaw) {
      const raw = JSON.stringify(payload, null, 2);
      if (Buffer.byteLength(raw, "utf8") <= CanvasMCPServer.MAX_RESPONSE_BYTES) {
        return raw;
      }
    }

    if (Array.isArray(payload)) {
      let itemCount = Math.min(payload.length, 25);
      while (itemCount > 0) {
        const slice = payload.slice(0, itemCount).map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? this.stripHeavyFields(item as Record<string, unknown>)
            : item
        );
        const serialized = JSON.stringify(
          { count: payload.length, items: slice, has_more: payload.length > itemCount },
          null,
          2
        );
        if (Buffer.byteLength(serialized, "utf8") <= CanvasMCPServer.MAX_RESPONSE_BYTES) {
          return serialized;
        }
        itemCount = Math.floor(itemCount / 2);
      }
      return JSON.stringify({
        count: payload.length,
        items: [],
        has_more: true,
        error: "Items too large to serialize. Request individual items by ID."
      });
    }

    const full = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(full, "utf8") <= CanvasMCPServer.MAX_RESPONSE_BYTES) {
      return full;
    }

    if (payload && typeof payload === "object") {
      const stripped = this.stripHeavyFields(payload as Record<string, unknown>);
      const strippedJson = JSON.stringify({ ...stripped, _truncated: true }, null, 2);
      if (Buffer.byteLength(strippedJson, "utf8") <= CanvasMCPServer.MAX_RESPONSE_BYTES) {
        return strippedJson;
      }
    }

    return JSON.stringify({
      error: "Response too large. Try requesting a more specific resource.",
      _truncated: true
    });
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof CanvasAPIError && typeof error.statusCode === "number") {
      return error.statusCode === 429 || error.statusCode >= 500;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes("timeout") || message.includes("temporarily") || message.includes("rate limit");
  }

  private toStructuredToolError(toolName: string, error: unknown): StructuredToolError {
    const message = error instanceof Error ? error.message : String(error);

    if (message.startsWith("Missing required field") || message.startsWith("Missing required fields")) {
      return {
        status: "error",
        retryable: false,
        suggestion: "Provide all required fields shown in tools/list inputSchema and retry.",
        message,
        code: "validation_error",
        tool: toolName
      };
    }

    if (message.startsWith("Unknown tool")) {
      return {
        status: "error",
        retryable: false,
        suggestion: "Call tools/list and use an exact tool name from that list.",
        message,
        code: "unknown_tool",
        tool: toolName
      };
    }

    if (error instanceof CanvasAPIError) {
      return {
        status: "error",
        retryable: this.isRetryable(error),
        suggestion: "Verify Canvas permissions, account/course IDs, and retry for transient Canvas failures.",
        message,
        code: "canvas_api_error",
        tool: toolName
      };
    }

    return {
      status: "error",
      retryable: this.isRetryable(error),
      suggestion: "Review input values and server logs, then retry.",
      message,
      code: "internal_error",
      tool: toolName
    };
  }

  private setupHandlers(): void {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const courses = await this.client.listCourses();
        
        return {
          resources: [
            {
              uri: "canvas://health",
              name: "Canvas Health Status",
              description: "Health check and API connectivity status",
              mimeType: "application/json"
            },
            {
              uri: "courses://list",
              name: "All Courses",
              description: "List of all available Canvas courses",
              mimeType: "application/json"
            },
            ...courses.map((course: CanvasCourse) => ({
              uri: `course://${course.id}`,
              name: `Course: ${course.name}`,
              description: `${course.course_code} - ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `assignments://${course.id}`,
              name: `Assignments: ${course.name}`,
              description: `Assignments for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `modules://${course.id}`,
              name: `Modules: ${course.name}`,
              description: `Modules for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `discussions://${course.id}`,
              name: `Discussions: ${course.name}`,
              description: `Discussion topics for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `announcements://${course.id}`,
              name: `Announcements: ${course.name}`,
              description: `Announcements for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `quizzes://${course.id}`,
              name: `Quizzes: ${course.name}`,
              description: `Quizzes for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `pages://${course.id}`,
              name: `Pages: ${course.name}`,
              description: `Pages for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `files://${course.id}`,
              name: `Files: ${course.name}`,
              description: `Files for ${course.name}`,
              mimeType: "application/json"
            })),
            {
              uri: "dashboard://user",
              name: "User Dashboard",
              description: "User's Canvas dashboard information",
              mimeType: "application/json"
            },
            {
              uri: "profile://user",
              name: "User Profile",
              description: "Current user's profile information",
              mimeType: "application/json"
            },
            {
              uri: "calendar://upcoming",
              name: "Upcoming Events",
              description: "Upcoming assignments and events",
              mimeType: "application/json"
            }
          ]
        };
      } catch (error) {
        console.error('Error listing resources:', error);
        return { resources: [] };
      }
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const [type, id] = uri.split("://");
      
      try {
        let content;
        
        switch (type) {
          case "canvas":
            if (id === "health") {
              content = await this.client.healthCheck();
            }
            break;
            
          case "courses":
            content = await this.client.listCourses();
            break;
            
          case "course":
            content = await this.client.getCourse(parseInt(id));
            break;
          
          case "assignments":
            content = await this.client.listAssignments(parseInt(id), true);
            break;
          
          case "modules":
            content = await this.client.listModules(parseInt(id));
            break;

          case "discussions":
            content = await this.client.listDiscussionTopics(parseInt(id));
            break;

          case "announcements":
            content = await this.client.listAnnouncements(parseInt(id));
            break;
          
          case "quizzes":
            content = await this.client.listQuizzes(parseInt(id));
            break;

          case "pages":
            content = await this.client.listPages(parseInt(id));
            break;

          case "files":
            content = await this.client.listFiles(parseInt(id));
            break;

          case "dashboard":
            if (id === "user") {
              content = await this.client.getDashboard();
            }
            break;

          case "profile":
            if (id === "user") {
              content = await this.client.getUserProfile();
            }
            break;

          case "calendar":
            if (id === "upcoming") {
              content = await this.client.getUpcomingAssignments();
            }
            break;
          
          default:
            throw new Error(`Unknown resource type: ${type}`);
        }

        if (content === undefined || content === null) {
          throw new Error(`No content found for resource: ${uri}`);
        }

        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(content, null, 2)
          }]
        };
      } catch (error) {
        console.error(`Error reading resource ${uri}:`, error);
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)
          }]
        };
      }
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools
    }));

    // Handle tool calls with comprehensive error handling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
        const includeRaw = rawArgs.include_raw === true;
        const { include_raw: _includeRaw, ...args } = rawArgs;
        const toolName = request.params.name;
        
        console.error(`[Canvas MCP] Executing tool: ${toolName}`);
        
        switch (toolName) {
          // Health check
          case "canvas_health_check": {
            const health = await this.client.healthCheck();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(health, includeRaw) }]
            };
          }

          // Course management
          case "canvas_list_courses": {
            const { include_ended = false } = args as { include_ended?: boolean };
            const courses = await this.client.listCourses(include_ended);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(courses, includeRaw) }]
            };
          }

          case "canvas_get_course": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const course = await this.client.getCourse(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(course, includeRaw) }]
            };
          }
          
          case "canvas_create_course": {
            const courseArgs = args as unknown as CreateCourseArgs;
            if (!courseArgs.account_id || !courseArgs.name) {
              throw new Error("Missing required fields: account_id and name");
            }
            const course = await this.client.createCourse(courseArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(course, includeRaw) }]
            };
          }
          
          case "canvas_update_course": {
            const updateArgs = args as unknown as UpdateCourseArgs;
            if (!updateArgs.course_id) {
              throw new Error("Missing required field: course_id");
            }
            const updatedCourse = await this.client.updateCourse(updateArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(updatedCourse, includeRaw) }]
            };
          }

          // Assignment management
          case "canvas_list_assignments": {
            const { course_id, include_submissions = false } = args as { 
              course_id: number; 
              include_submissions?: boolean 
            };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const assignments = await this.client.listAssignments(course_id, include_submissions);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(assignments, includeRaw) }]
            };
          }

          case "canvas_get_assignment": {
            const { course_id, assignment_id, include_submission = false } = args as { 
              course_id: number; 
              assignment_id: number;
              include_submission?: boolean;
            };
            if (!course_id || !assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }
            
            const assignment = await this.client.getAssignment(course_id, assignment_id, include_submission);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(assignment, includeRaw) }]
            };
          }
          
          case "canvas_create_assignment": {
            const assignmentArgs = args as unknown as CreateAssignmentArgs;
            if (!assignmentArgs.course_id || !assignmentArgs.name) {
              throw new Error("Missing required fields: course_id and name");
            }
            const assignment = await this.client.createAssignment(assignmentArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(assignment, includeRaw) }]
            };
          }
          
          case "canvas_update_assignment": {
            const updateAssignmentArgs = args as unknown as UpdateAssignmentArgs;
            if (!updateAssignmentArgs.course_id || !updateAssignmentArgs.assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }
            const updatedAssignment = await this.client.updateAssignment(updateAssignmentArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(updatedAssignment, includeRaw) }]
            };
          }

          case "canvas_list_assignment_groups": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const groups = await this.client.listAssignmentGroups(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(groups, includeRaw) }]
            };
          }

          // Submissions
          case "canvas_get_submission": {
            const { course_id, assignment_id, user_id } = args as { 
              course_id: number; 
              assignment_id: number;
              user_id?: number;
            };
            if (!course_id || !assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }
            
            const submission = await this.client.getSubmission(course_id, assignment_id, user_id || 'self');
            return {
              content: [{ type: "text", text: this.serializeToolOutput(submission, includeRaw) }]
            };
          }

          case "canvas_submit_assignment": {
            const submitArgs = args as unknown as SubmitAssignmentArgs;
            const { course_id, assignment_id, submission_type } = submitArgs;

            if (!course_id || !assignment_id || !submission_type) {
              throw new Error("Missing required fields: course_id, assignment_id, and submission_type");
            }

            const submission = await this.client.submitAssignment(submitArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(submission, includeRaw) }]
            };
          }
          
          case "canvas_submit_grade": {
            const gradeArgs = args as unknown as SubmitGradeArgs;
            if (!gradeArgs.course_id || !gradeArgs.assignment_id || 
                !gradeArgs.user_id || gradeArgs.grade === undefined) {
              throw new Error("Missing required fields for grade submission");
            }
            const submission = await this.client.submitGrade(gradeArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(submission, includeRaw) }]
            };
          }

          // Files
          case "canvas_list_files": {
            const { course_id, folder_id } = args as { course_id: number; folder_id?: number };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const files = await this.client.listFiles(course_id, folder_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(files, includeRaw) }]
            };
          }

          case "canvas_get_file": {
            const { file_id } = args as { file_id: number };
            if (!file_id) throw new Error("Missing required field: file_id");
            
            const file = await this.client.getFile(file_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(file, includeRaw) }]
            };
          }

          case "canvas_get_file_content": {
            const { file_id, offset = 0, limit: charLimit } = args as {
              file_id: number;
              offset?: number;
              limit?: number;
            };
            if (!file_id) throw new Error("Missing required field: file_id");

            const { buffer, file: fileMeta } = await this.client.downloadFileContent(file_id);
            const detectedType = detectContentType(fileMeta.content_type, fileMeta.filename);

            if (detectedType === 'unsupported') {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    error: `Unsupported file type for text extraction: ${fileMeta.content_type} (${fileMeta.filename})`,
                    supported_types: ["pdf", "docx", "pptx", "html", "txt"]
                  })
                }]
              };
            }

            let extractedText = await extractText(buffer, detectedType);
            const totalLength = extractedText.length;

            if (offset > 0) {
              extractedText = extractedText.slice(offset);
            }
            if (charLimit !== undefined && charLimit > 0) {
              extractedText = extractedText.slice(0, charLimit);
            }

            const result = {
              file_id: fileMeta.id,
              filename: fileMeta.display_name,
              content_type: fileMeta.content_type,
              detected_type: detectedType,
              file_size_bytes: fileMeta.size,
              total_text_length: totalLength,
              offset,
              returned_length: extractedText.length,
              has_more: offset + extractedText.length < totalLength,
              content: extractedText
            };

            return {
              content: [{ type: "text", text: this.serializeToolOutput(result, includeRaw) }]
            };
          }

          case "canvas_get_course_content": {
            const {
              course_id,
              module_id: filterModuleId,
              content_type: filterType = "all",
              max_items = 50,
              before_date: beforeDateStr,
              after_date: afterDateStr
            } = args as {
              course_id: number;
              module_id?: number;
              content_type?: string;
              max_items?: number;
              before_date?: string;
              after_date?: string;
            };
            if (!course_id) throw new Error("Missing required field: course_id");

            const effectiveMax = Math.min(Math.max(max_items, 1), 200);
            const PER_ITEM_CHAR_LIMIT = 20_000;
            const DOWNLOAD_CONCURRENCY = 5;
            const beforeDate = beforeDateStr ? new Date(beforeDateStr) : null;
            const afterDate = afterDateStr ? new Date(afterDateStr) : null;

            let modules = await this.client.listModules(course_id);
            if (filterModuleId) {
              modules = modules.filter(m => m.id === filterModuleId);
              if (modules.length === 0) {
                throw new Error(`Module ${filterModuleId} not found in course ${course_id}`);
              }
            }

            type PendingItem = {
              modName: string;
              modId: number;
              item: { type: string; title: string; page_url?: string; content_id?: number; content_details?: { due_at?: string; unlock_at?: string; lock_at?: string } };
            };
            const pendingItems: PendingItem[] = [];

            for (const mod of modules) {
              const items = mod.items ?? await this.client.listModuleItems(course_id, mod.id);
              for (const item of items) {
                if (beforeDate || afterDate) {
                  const itemDate = item.content_details?.due_at || item.content_details?.unlock_at;
                  if (itemDate) {
                    const d = new Date(itemDate);
                    if (beforeDate && d >= beforeDate) continue;
                    if (afterDate && d <= afterDate) continue;
                  }
                }
                if (item.type === 'Page') {
                  if (filterType !== 'all' && filterType !== 'page' && filterType !== 'html') continue;
                  pendingItems.push({ modName: mod.name, modId: mod.id, item });
                } else if (item.type === 'File' && item.content_id) {
                  pendingItems.push({ modName: mod.name, modId: mod.id, item });
                }
                if (pendingItems.length >= effectiveMax) break;
              }
              if (pendingItems.length >= effectiveMax) break;
            }

            type ContentResult = {
              module_name: string; module_id: number; item_title: string;
              item_type: string; detected_type: string; char_count: number;
              truncated: boolean; content: string; error?: string;
            } | null;

            const processItem = async (pending: PendingItem): Promise<ContentResult> => {
              const { modName, modId, item } = pending;
              try {
                if (item.type === 'Page') {
                  if (!item.page_url) return null;
                  const pageData = await this.client.getPage(course_id, item.page_url);
                  let text = pageData.body ? stripHtml(pageData.body) : '';
                  const truncated = text.length > PER_ITEM_CHAR_LIMIT;
                  if (truncated) text = text.slice(0, PER_ITEM_CHAR_LIMIT);
                  return { module_name: modName, module_id: modId, item_title: item.title, item_type: 'Page', detected_type: 'html', char_count: truncated ? (pageData.body?.length ?? 0) : text.length, truncated, content: text };
                } else if (item.type === 'File' && item.content_id) {
                  const { buffer: fileBuf, file: fileInfo } = await this.client.downloadFileContent(item.content_id);
                  const detected = detectContentType(fileInfo.content_type, fileInfo.filename);
                  if (detected === 'unsupported') return null;
                  if (filterType !== 'all' && filterType !== detected) return null;
                  let text = await extractText(fileBuf, detected);
                  const truncated = text.length > PER_ITEM_CHAR_LIMIT;
                  if (truncated) text = text.slice(0, PER_ITEM_CHAR_LIMIT);
                  return { module_name: modName, module_id: modId, item_title: item.title, item_type: 'File', detected_type: detected, char_count: truncated ? -1 : text.length, truncated, content: text };
                }
                return null;
              } catch (itemErr) {
                return { module_name: modName, module_id: modId, item_title: item.title, item_type: item.type, detected_type: 'unknown', char_count: 0, truncated: false, content: '', error: itemErr instanceof Error ? itemErr.message : String(itemErr) };
              }
            };

            const rawResults = await pMap(pendingItems, processItem, DOWNLOAD_CONCURRENCY);
            const contentItems = rawResults.filter((r): r is NonNullable<ContentResult> => r !== null);

            const output = {
              course_id,
              modules_scanned: modules.length,
              items_extracted: contentItems.length,
              max_items: effectiveMax,
              filter_content_type: filterType,
              before_date: beforeDateStr ?? null,
              after_date: afterDateStr ?? null,
              items: contentItems
            };

            return {
              content: [{ type: "text", text: this.serializeToolOutput(output, includeRaw) }]
            };
          }

          case "canvas_list_folders": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const folders = await this.client.listFolders(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(folders, includeRaw) }]
            };
          }

          // Pages
          case "canvas_list_pages": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const pages = await this.client.listPages(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(pages, includeRaw) }]
            };
          }

          case "canvas_get_page": {
            const { course_id, page_url } = args as { course_id: number; page_url: string };
            if (!course_id || !page_url) {
              throw new Error("Missing required fields: course_id and page_url");
            }
            
            const page = await this.client.getPage(course_id, page_url);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(page, includeRaw) }]
            };
          }

          // Calendar
          case "canvas_list_calendar_events": {
            const { start_date, end_date } = args as { start_date?: string; end_date?: string };
            const events = await this.client.listCalendarEvents(start_date, end_date);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(events, includeRaw) }]
            };
          }

          case "canvas_get_upcoming_assignments": {
            const { limit = 10 } = args as { limit?: number };
            const assignments = await this.client.getUpcomingAssignments(limit);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(assignments, includeRaw) }]
            };
          }

          // Dashboard
          case "canvas_get_dashboard": {
            const dashboard = await this.client.getDashboard();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(dashboard, includeRaw) }]
            };
          }

          case "canvas_get_dashboard_cards": {
            const cards = await this.client.getDashboardCards();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(cards, includeRaw) }]
            };
          }

          // User management
          case "canvas_get_user_profile": {
            const profile = await this.client.getUserProfile();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(profile, includeRaw) }]
            };
          }

          case "canvas_update_user_profile": {
            const profileData = args as Partial<{ name: string; short_name: string; bio: string; title: string; time_zone: string }>;
            const updatedProfile = await this.client.updateUserProfile(profileData);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(updatedProfile, includeRaw) }]
            };
          }

          case "canvas_enroll_user": {
            const enrollArgs = args as unknown as EnrollUserArgs;
            if (!enrollArgs.course_id || !enrollArgs.user_id) {
              throw new Error("Missing required fields: course_id and user_id");
            }
            const enrollment = await this.client.enrollUser(enrollArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(enrollment, includeRaw) }]
            };
          }

          // Grades
          case "canvas_get_course_grades": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");
            
            const grades = await this.client.getCourseGrades(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(grades, includeRaw) }]
            };
          }

          case "canvas_get_user_grades": {
            const grades = await this.client.getUserGrades();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(grades, includeRaw) }]
            };
          }

          // Modules
          case "canvas_list_modules": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const modules = await this.client.listModules(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(modules, includeRaw) }]
            };
          }

          case "canvas_get_module": {
            const { course_id, module_id } = args as { course_id: number; module_id: number };
            if (!course_id || !module_id) {
              throw new Error("Missing required fields: course_id and module_id");
            }

            const module = await this.client.getModule(course_id, module_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(module, includeRaw) }]
            };
          }

          case "canvas_list_module_items": {
            const { course_id, module_id } = args as { course_id: number; module_id: number };
            if (!course_id || !module_id) {
              throw new Error("Missing required fields: course_id and module_id");
            }

            const moduleItems = await this.client.listModuleItems(course_id, module_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(moduleItems, includeRaw) }]
            };
          }

          case "canvas_get_module_item": {
            const { course_id, module_id, item_id } = args as { course_id: number; module_id: number; item_id: number };
            if (!course_id || !module_id || !item_id) {
              throw new Error("Missing required fields: course_id, module_id, and item_id");
            }

            const moduleItem = await this.client.getModuleItem(course_id, module_id, item_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(moduleItem, includeRaw) }]
            };
          }

          case "canvas_mark_module_item_complete": {
            const { course_id, module_id, item_id } = args as { course_id: number; module_id: number; item_id: number };
            if (!course_id || !module_id || !item_id) {
              throw new Error("Missing required fields: course_id, module_id, and item_id");
            }

            await this.client.markModuleItemComplete(course_id, module_id, item_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput({ status: "ok" }, includeRaw) }]
            };
          }

          // Discussions and announcements
          case "canvas_list_discussion_topics": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const topics = await this.client.listDiscussionTopics(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(topics, includeRaw) }]
            };
          }

          case "canvas_get_discussion_topic": {
            const { course_id, topic_id } = args as { course_id: number; topic_id: number };
            if (!course_id || !topic_id) {
              throw new Error("Missing required fields: course_id and topic_id");
            }

            const topic = await this.client.getDiscussionTopic(course_id, topic_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(topic, includeRaw) }]
            };
          }

          case "canvas_post_to_discussion": {
            const { course_id, topic_id, message } = args as { course_id: number; topic_id: number; message: string };
            if (!course_id || !topic_id || !message) {
              throw new Error("Missing required fields: course_id, topic_id, and message");
            }

            const post = await this.client.postToDiscussion(course_id, topic_id, message);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(post, includeRaw) }]
            };
          }

          case "canvas_list_announcements": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const announcements = await this.client.listAnnouncements(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(announcements, includeRaw) }]
            };
          }

          // Quizzes
          case "canvas_list_quizzes": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const quizzes = await this.client.listQuizzes(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(quizzes, includeRaw) }]
            };
          }

          case "canvas_get_quiz": {
            const { course_id, quiz_id } = args as { course_id: number; quiz_id: number };
            if (!course_id || !quiz_id) {
              throw new Error("Missing required fields: course_id and quiz_id");
            }

            const quiz = await this.client.getQuiz(course_id, quiz_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(quiz, includeRaw) }]
            };
          }

          case "canvas_create_quiz": {
            const { course_id, ...quizData } = args as { course_id: number; title?: string; [key: string]: unknown };
            if (!course_id || !quizData.title) {
              throw new Error("Missing required fields: course_id and title");
            }

            const quiz = await this.client.createQuiz(course_id, quizData);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(quiz, includeRaw) }]
            };
          }

          case "canvas_start_quiz_attempt": {
            const { course_id, quiz_id } = args as { course_id: number; quiz_id: number };
            if (!course_id || !quiz_id) {
              throw new Error("Missing required fields: course_id and quiz_id");
            }

            const quizAttempt = await this.client.startQuizAttempt(course_id, quiz_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(quizAttempt, includeRaw) }]
            };
          }

          // Rubrics
          case "canvas_list_rubrics": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const rubrics = await this.client.listRubrics(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(rubrics, includeRaw) }]
            };
          }

          case "canvas_get_rubric": {
            const { course_id, rubric_id } = args as { course_id: number; rubric_id: number };
            if (!course_id || !rubric_id) {
              throw new Error("Missing required fields: course_id and rubric_id");
            }

            const rubric = await this.client.getRubric(course_id, rubric_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(rubric, includeRaw) }]
            };
          }

          // Conversations and notifications
          case "canvas_list_conversations": {
            const conversations = await this.client.listConversations();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(conversations, includeRaw) }]
            };
          }

          case "canvas_get_conversation": {
            const { conversation_id } = args as { conversation_id: number };
            if (!conversation_id) throw new Error("Missing required field: conversation_id");

            const conversation = await this.client.getConversation(conversation_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(conversation, includeRaw) }]
            };
          }

          case "canvas_create_conversation": {
            const { recipients, body, subject } = args as { recipients: string[]; body: string; subject?: string };
            if (!recipients || recipients.length === 0 || !body) {
              throw new Error("Missing required fields: recipients and body");
            }

            const conversation = await this.client.createConversation(recipients, body, subject);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(conversation, includeRaw) }]
            };
          }

          case "canvas_list_notifications": {
            const notifications = await this.client.listNotifications();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(notifications, includeRaw) }]
            };
          }

          case "canvas_get_syllabus": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const syllabus = await this.client.getSyllabus(course_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(syllabus, includeRaw) }]
            };
          }
          
          // Account Management
          case "canvas_get_account": {
            const { account_id } = args as { account_id: number };
            if (!account_id) throw new Error("Missing required field: account_id");
            
            const account = await this.client.getAccount(account_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(account, includeRaw) }]
            };
          }

          case "canvas_list_account_courses": {
            const accountCoursesArgs = args as unknown as ListAccountCoursesArgs;
            if (!accountCoursesArgs.account_id) {
              throw new Error("Missing required field: account_id");
            }
            
            const courses = await this.client.listAccountCourses(accountCoursesArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(courses, includeRaw) }]
            };
          }

          case "canvas_list_account_users": {
            const accountUsersArgs = args as unknown as ListAccountUsersArgs;
            if (!accountUsersArgs.account_id) {
              throw new Error("Missing required field: account_id");
            }
            
            const users = await this.client.listAccountUsers(accountUsersArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(users, includeRaw) }]
            };
          }

          case "canvas_create_user": {
            const createUserArgs = args as unknown as CreateUserArgs;
            if (!createUserArgs.account_id || !createUserArgs.user || !createUserArgs.pseudonym) {
              throw new Error("Missing required fields: account_id, user, and pseudonym");
            }
            
            const user = await this.client.createUser(createUserArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(user, includeRaw) }]
            };
          }

          case "canvas_list_sub_accounts": {
            const { account_id } = args as { account_id: number };
            if (!account_id) throw new Error("Missing required field: account_id");
            
            const subAccounts = await this.client.listSubAccounts(account_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(subAccounts, includeRaw) }]
            };
          }

          case "canvas_get_account_reports": {
            const { account_id } = args as { account_id: number };
            if (!account_id) throw new Error("Missing required field: account_id");
            
            const reports = await this.client.getAccountReports(account_id);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(reports, includeRaw) }]
            };
          }

          case "canvas_create_account_report": {
            const createReportArgs = args as unknown as CreateReportArgs;
            if (!createReportArgs.account_id || !createReportArgs.report) {
              throw new Error("Missing required fields: account_id and report");
            }
            
            const report = await this.client.createAccountReport(createReportArgs);
            return {
              content: [{ type: "text", text: this.serializeToolOutput(report, includeRaw) }]
            };
          }

          // Search
          case "canvas_search_course_content": {
            const { course_id, search_term, content_types } = args as {
              course_id: number;
              search_term: string;
              content_types?: string[];
            };
            if (!course_id || !search_term) {
              throw new Error("Missing required fields: course_id and search_term");
            }

            const types = content_types ?? ["files", "pages", "assignments", "discussions"];
            const searchResults: Record<string, unknown> = {};

            const searches: Promise<void>[] = [];
            if (types.includes("files")) {
              searches.push(
                this.client.searchFiles(course_id, search_term)
                  .then(files => { searchResults.files = files; })
                  .catch(e => { searchResults.files_error = e instanceof Error ? e.message : String(e); })
              );
            }
            if (types.includes("pages")) {
              searches.push(
                this.client.searchPages(course_id, search_term)
                  .then(pages => { searchResults.pages = pages; })
                  .catch(e => { searchResults.pages_error = e instanceof Error ? e.message : String(e); })
              );
            }
            if (types.includes("assignments")) {
              searches.push(
                this.client.listAssignments(course_id)
                  .then(assignments => {
                    const term = search_term.toLowerCase();
                    searchResults.assignments = assignments.filter(a =>
                      a.name.toLowerCase().includes(term) ||
                      (a.description && a.description.toLowerCase().includes(term))
                    );
                  })
                  .catch(e => { searchResults.assignments_error = e instanceof Error ? e.message : String(e); })
              );
            }
            if (types.includes("discussions")) {
              searches.push(
                this.client.listDiscussionTopics(course_id)
                  .then(topics => {
                    const term = search_term.toLowerCase();
                    searchResults.discussions = topics.filter(t =>
                      t.title.toLowerCase().includes(term) ||
                      (t.message && t.message.toLowerCase().includes(term))
                    );
                  })
                  .catch(e => { searchResults.discussions_error = e instanceof Error ? e.message : String(e); })
              );
            }

            await Promise.all(searches);

            return {
              content: [{ type: "text", text: this.serializeToolOutput({ course_id, search_term, ...searchResults }, includeRaw) }]
            };
          }

          // Course timeline
          case "canvas_get_course_timeline": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const [timelineModules, timelineAssignments, timelineCourse] = await Promise.all([
              this.client.listModules(course_id),
              this.client.listAssignments(course_id),
              this.client.getCourse(course_id)
            ]);

            const assignmentMap = new Map(
              timelineAssignments.map(a => [a.id as number, a])
            );

            const timeline = timelineModules.map(mod => {
              const items = (mod.items ?? []).map(item => {
                const entry: Record<string, unknown> = {
                  title: item.title,
                  type: item.type,
                  position: item.position,
                  content_id: item.content_id
                };
                if (item.content_details) {
                  if (item.content_details.due_at) entry.due_at = item.content_details.due_at;
                  if (item.content_details.unlock_at) entry.unlock_at = item.content_details.unlock_at;
                  if (item.content_details.lock_at) entry.lock_at = item.content_details.lock_at;
                }
                if (item.type === 'Assignment' && item.content_id) {
                  const asgn = assignmentMap.get(item.content_id);
                  if (asgn) {
                    entry.points_possible = asgn.points_possible;
                    entry.submission_types = asgn.submission_types;
                    if (asgn.due_at) entry.due_at = asgn.due_at;
                  }
                }
                return entry;
              });

              return {
                module_id: mod.id,
                module_name: mod.name,
                position: mod.position,
                state: mod.state,
                items_count: items.length,
                items
              };
            });

            return {
              content: [{ type: "text", text: this.serializeToolOutput({
                course_id,
                course_name: timelineCourse.name,
                course_start: timelineCourse.start_at,
                course_end: timelineCourse.end_at,
                term: timelineCourse.term,
                modules_count: timelineModules.length,
                total_items: timeline.reduce((sum, m) => sum + m.items_count, 0),
                timeline
              }, includeRaw) }]
            };
          }

          // Assignment content extraction
          case "canvas_get_assignment_content": {
            const { course_id, assignment_id } = args as { course_id: number; assignment_id: number };
            if (!course_id || !assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }

            const asgn = await this.client.getAssignment(course_id, assignment_id);
            const cleanDescription = asgn.description ? stripHtml(asgn.description) : '';

            return {
              content: [{ type: "text", text: this.serializeToolOutput({
                assignment_id: asgn.id,
                name: asgn.name,
                due_at: asgn.due_at,
                lock_at: asgn.lock_at,
                unlock_at: asgn.unlock_at,
                points_possible: asgn.points_possible,
                submission_types: asgn.submission_types,
                grading_type: asgn.grading_type,
                description_text: cleanDescription,
                description_length: cleanDescription.length
              }, includeRaw) }]
            };
          }

          // Submission feedback
          case "canvas_get_submission_feedback": {
            const { course_id, assignment_id, user_id } = args as {
              course_id: number;
              assignment_id: number;
              user_id?: number;
            };
            if (!course_id || !assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }

            const sub = await this.client.getSubmission(course_id, assignment_id, user_id || 'self');
            const feedback: Record<string, unknown> = {
              assignment_id,
              submission_id: sub.id,
              workflow_state: sub.workflow_state,
              submitted_at: sub.submitted_at,
              score: sub.score,
              grade: sub.grade,
              late: sub.late,
              missing: sub.missing,
              attempt: sub.attempt
            };

            if (sub.submission_comments && sub.submission_comments.length > 0) {
              feedback.comments = sub.submission_comments.map(c => ({
                author: c.author_name,
                comment: c.comment,
                created_at: c.created_at
              }));
            }
            if (sub.rubric_assessment) {
              feedback.rubric_assessment = sub.rubric_assessment;
            }

            return {
              content: [{ type: "text", text: this.serializeToolOutput(feedback, includeRaw) }]
            };
          }

          // Todo items
          case "canvas_get_todo_items": {
            const todoItems = await this.client.getTodoItems();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(todoItems, includeRaw) }]
            };
          }

          // Unread counts
          case "canvas_get_unread_counts": {
            const activitySummary = await this.client.getActivityStreamSummary();
            return {
              content: [{ type: "text", text: this.serializeToolOutput(activitySummary, includeRaw) }]
            };
          }
          
          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
      } catch (error) {
        console.error(`Error executing tool ${request.params.name}:`, error);
        const structuredError = this.toStructuredToolError(request.params.name, error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(structuredError, null, 2)
          }],
          structuredContent: structuredError,
          isError: true
        };
      }
    });
  }

  private async parseHttpRequestBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
      return undefined;
    }

    const rawBody = Buffer.concat(chunks).toString("utf8").trim();
    if (!rawBody) {
      return undefined;
    }

    return JSON.parse(rawBody);
  }

  private getHttpConfig() {
    return {
      host: this.config.transport?.http?.host ?? "127.0.0.1",
      port: this.config.transport?.http?.port ?? 3000,
      path: this.config.transport?.http?.path ?? "/mcp",
      statefulSession: this.config.transport?.http?.statefulSession ?? true,
      enableJsonResponse: this.config.transport?.http?.enableJsonResponse ?? true,
      allowedOrigins: this.config.transport?.http?.allowedOrigins ?? []
    };
  }

  private isAllowedOrigin(req: IncomingMessage): boolean {
    const { allowedOrigins } = this.getHttpConfig();
    if (allowedOrigins.length === 0) {
      return true;
    }

    const origin = req.headers.origin;
    if (!origin) {
      return true;
    }

    return allowedOrigins.includes(origin);
  }

  async connectStdio(stdin?: Readable, stdout?: Writable): Promise<void> {
    const transport = new StdioServerTransport(stdin, stdout);
    await this.server.connect(transport);
    console.error(`${this.config.name} running on stdio`);
  }

  async connectStreamableHttp(): Promise<void> {
    if (this.streamableHttpRuntime) {
      return;
    }

    const httpConfig = this.getHttpConfig();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: httpConfig.statefulSession ? () => randomUUID() : undefined,
      enableJsonResponse: httpConfig.enableJsonResponse
    });
    await this.server.connect(transport);

    const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname !== httpConfig.path) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Not Found" }));
          return;
        }

        if (!this.isAllowedOrigin(req)) {
          res.statusCode = 403;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Forbidden origin" }));
          return;
        }

        const method = req.method?.toUpperCase() ?? "GET";
        if (!["POST", "GET", "DELETE"].includes(method)) {
          res.statusCode = 405;
          res.setHeader("allow", "POST, GET, DELETE");
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
          return;
        }

        let parsedBody: unknown;
        if (method === "POST") {
          try {
            parsedBody = await this.parseHttpRequestBody(req);
          } catch {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
        }

        await transport.handleRequest(req, res, parsedBody);
      } catch (error) {
        console.error(`Error handling streamable-http request:`, error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: "Internal server error"
              },
              id: null
            })
          );
        }
      }
    };

    const httpServer = createHttpServer((req, res) => {
      void requestHandler(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(httpConfig.port, httpConfig.host, () => resolve());
    });

    this.streamableHttpRuntime = { transport, httpServer };
    console.error(
      `${this.config.name} running on streamable-http at http://${httpConfig.host}:${httpConfig.port}${httpConfig.path}`
    );
  }

  getStreamableHttpUrl(): string | undefined {
    if (!this.streamableHttpRuntime) {
      return undefined;
    }

    const httpConfig = this.getHttpConfig();
    const address = this.streamableHttpRuntime.httpServer.address();
    if (!address || typeof address === "string") {
      return undefined;
    }

    const info = address as AddressInfo;
    return `http://${httpConfig.host}:${info.port}${httpConfig.path}`;
  }

  async close(): Promise<void> {
    if (this.streamableHttpRuntime) {
      await this.streamableHttpRuntime.transport.close();
      await new Promise<void>((resolve, reject) => {
        this.streamableHttpRuntime?.httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.streamableHttpRuntime = undefined;
    }

    await this.server.close();
  }

  async run(): Promise<void> {
    const mode = this.config.transport?.mode ?? "stdio";
    if (mode === "streamable-http") {
      await this.connectStreamableHttp();
      return;
    }

    await this.connectStdio();
  }
}

export async function loadEnvironmentVariables(): Promise<void> {
  if (process.env.CANVAS_API_TOKEN && process.env.CANVAS_DOMAIN) {
    return;
  }

  let dotenv;
  try {
    dotenv = await import("dotenv");
  } catch {
    console.error("Warning: dotenv not available, relying on environment variables");
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const envPaths = [
    ".env",
    "src/.env",
    path.join(__dirname, ".env"),
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env")
  ];

  let loaded = false;
  for (const envPath of envPaths) {
    const result = dotenv.config({ path: envPath });
    if (result.parsed) {
      console.error(`Loaded environment from: ${envPath}`);
      loaded = true;
      break;
    }
  }

  if (!loaded) {
    console.error("Warning: No .env file found");
  }
}

export function loadConfigFromEnvironment(env = process.env): MCPServerConfig {
  const token = env.CANVAS_API_TOKEN;
  const domain = env.CANVAS_DOMAIN;

  if (!token || !domain) {
    throw new Error(
      "Missing required environment variables: CANVAS_API_TOKEN and CANVAS_DOMAIN are required."
    );
  }

  const transportMode = env.MCP_TRANSPORT === "streamable-http" ? "streamable-http" : "stdio";
  const allowedOrigins = (env.MCP_HTTP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const role = (env.CANVAS_ROLE || "all") as MCPServerConfig["role"];

  return {
    name: "canvas-mcp-server",
    version: "2.3.0",
    canvas: {
      token,
      domain,
      maxRetries: parseInt(env.CANVAS_MAX_RETRIES || "3", 10),
      retryDelay: parseInt(env.CANVAS_RETRY_DELAY || "1000", 10),
      timeout: parseInt(env.CANVAS_TIMEOUT || "30000", 10)
    },
    role,
    logging: {
      level: (env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info"
    },
    transport: {
      mode: transportMode,
      http: {
        host: env.MCP_HTTP_HOST || "127.0.0.1",
        port: parseInt(env.MCP_HTTP_PORT || "3000", 10),
        path: env.MCP_HTTP_PATH || "/mcp",
        statefulSession: (env.MCP_HTTP_STATEFUL || "true") !== "false",
        enableJsonResponse: (env.MCP_HTTP_JSON_RESPONSE || "true") !== "false",
        allowedOrigins
      }
    }
  };
}

export async function main(): Promise<void> {
  await loadEnvironmentVariables();

  let server: CanvasMCPServer | undefined;
  try {
    const config = loadConfigFromEnvironment(process.env);
    server = new CanvasMCPServer(config);

    const shutdown = async (signal: string) => {
      console.error(`Received ${signal}, shutting down...`);
      if (server) {
        await server.close();
      }
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    await server.run();
  } catch (error) {
    console.error("Fatal error:", error);
    if (server) {
      await server.close().catch((closeError) => {
        console.error("Error while closing server:", closeError);
      });
    }
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
