// Every state-changing call from the app goes through one of these, each checking permissions itself.
import * as notifications from "./notifications";
import * as entries from "./entries";
import * as projects from "./projects";
import * as mash from "./mash";
import * as profile from "./profile";
import * as people from "./people";
import type { Action } from "./types";

const pick = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === "function")) as Record<string, Action>;
export const actions: Record<string, Action> = {
  ...pick(notifications), ...pick(entries), ...pick(projects), ...pick(mash), ...pick(profile), ...pick(people)
};
// Helpers exported from those modules that aren't callable actions.
for (const k of ["gcMedia", "sendInviteEmail", "deleteUserCompletely", "TOMBSTONE_DOMAIN"]) delete actions[k];
