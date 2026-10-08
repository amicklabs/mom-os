/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as device from "../device.js";
import type * as dispatcher from "../dispatcher.js";
import type * as http from "../http.js";
import type * as lib_actions from "../lib/actions.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_content from "../lib/content.js";
import type * as lib_format from "../lib/format.js";
import type * as lib_gaps from "../lib/gaps.js";
import type * as lib_help from "../lib/help.js";
import type * as lib_jobs from "../lib/jobs.js";
import type * as lib_report from "../lib/report.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_telegramApi from "../lib/telegramApi.js";
import type * as provision from "../provision.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as slideshow from "../slideshow.js";
import type * as telegram from "../telegram.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  cleanup: typeof cleanup;
  crons: typeof crons;
  device: typeof device;
  dispatcher: typeof dispatcher;
  http: typeof http;
  "lib/actions": typeof lib_actions;
  "lib/auth": typeof lib_auth;
  "lib/content": typeof lib_content;
  "lib/format": typeof lib_format;
  "lib/gaps": typeof lib_gaps;
  "lib/help": typeof lib_help;
  "lib/jobs": typeof lib_jobs;
  "lib/report": typeof lib_report;
  "lib/settings": typeof lib_settings;
  "lib/telegramApi": typeof lib_telegramApi;
  provision: typeof provision;
  reminders: typeof reminders;
  reports: typeof reports;
  slideshow: typeof slideshow;
  telegram: typeof telegram;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
