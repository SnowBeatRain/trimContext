export type HookSettings = Record<string, unknown>;

export const TRIMCTX_MANAGED_HOOK_FLAG = "--trimctx-managed-hook";

export interface HookCommands {
  sessionStart: string;
  stop: string;
}

const LEGACY_HOOK_COMMANDS: HookCommands = {
  sessionStart: "trimctx hook --session-start",
  stop: "trimctx hook"
};

interface HookEntry extends Record<string, unknown> {
  type?: string;
  command?: string;
}

interface HookGroup extends Record<string, unknown> {
  hooks?: HookEntry[];
}

export type HookSettingsPlan =
  | { status: "already_installed" }
  | { status: "write"; settings: HookSettings };

export function planHookSettings(
  input: unknown,
  commands: HookCommands,
  options: { force?: boolean } = {}
): HookSettingsPlan {
  const settings = requiredObject(input, "Claude settings");
  const hooks = settings.hooks === undefined
    ? {}
    : requiredObject(settings.hooks, "Claude settings hooks");
  const sessionStartHooks = eventGroups(hooks, "SessionStart");
  const stopHooks = eventGroups(hooks, "Stop");
  const hasSessionEnvHook = containsHook(sessionStartHooks, commands.sessionStart);
  const hasTrimctxHook = containsHook(stopHooks, commands.stop);
  const hasStaleSessionEnvHook = containsStaleManagedHook(
    sessionStartHooks,
    commands.sessionStart,
    "sessionStart"
  );
  const hasStaleTrimctxHook = containsStaleManagedHook(stopHooks, commands.stop, "stop");

  if (
    hasSessionEnvHook &&
    hasTrimctxHook &&
    !hasStaleSessionEnvHook &&
    !hasStaleTrimctxHook &&
    !options.force
  ) {
    return { status: "already_installed" };
  }

  const newSessionStartHooks = removeOwnedHookEntries(
    sessionStartHooks,
    commands.sessionStart,
    LEGACY_HOOK_COMMANDS.sessionStart,
    "sessionStart",
    options.force === true
  );
  const newStopHooks = removeOwnedHookEntries(
    stopHooks,
    commands.stop,
    LEGACY_HOOK_COMMANDS.stop,
    "stop",
    options.force === true
  );

  if (!hasSessionEnvHook || options.force) {
    newSessionStartHooks.push(trimctxHookGroup(commands.sessionStart));
  }
  if (!hasTrimctxHook || options.force) {
    newStopHooks.push(trimctxHookGroup(commands.stop));
  }

  return {
    status: "write",
    settings: {
      ...settings,
      hooks: {
        ...hooks,
        SessionStart: newSessionStartHooks,
        Stop: newStopHooks
      }
    }
  };
}

export function plannedHookSettings(commands: HookCommands): HookSettings {
  return {
    hooks: {
      SessionStart: [trimctxHookGroup(commands.sessionStart)],
      Stop: [trimctxHookGroup(commands.stop)]
    }
  };
}

function eventGroups(hooks: HookSettings, event: "SessionStart" | "Stop"): HookGroup[] {
  const value = hooks[event];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Claude settings hooks.${event} must be an array`);
  }
  return value.map((group, groupIndex) => {
    const groupPath = `Claude settings hooks.${event}[${groupIndex}]`;
    const parsedGroup = requiredObject(group, groupPath) as HookGroup;
    if (parsedGroup.hooks === undefined) return parsedGroup;
    if (!Array.isArray(parsedGroup.hooks)) {
      throw new Error(`${groupPath}.hooks must be an array`);
    }
    const entries = parsedGroup.hooks.map((entry, entryIndex) =>
      requiredObject(entry, `${groupPath}.hooks[${entryIndex}]`) as HookEntry
    );
    return { ...parsedGroup, hooks: entries };
  });
}

function requiredObject(value: unknown, path: string): HookSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as HookSettings;
}

function containsHook(groups: HookGroup[], command: string): boolean {
  return groups.some((group) => (group.hooks ?? []).some((entry) => isHook(entry, command)));
}

function removeHookEntries(groups: HookGroup[], shouldRemove: (entry: HookEntry) => boolean): HookGroup[] {
  return groups.flatMap((group) => {
    if (!group.hooks) return [group];
    const remaining = group.hooks.filter((entry) => !shouldRemove(entry));
    if (remaining.length === group.hooks.length) return [group];
    if (remaining.length === 0) return [];
    return [{ ...group, hooks: remaining }];
  });
}

function removeOwnedHookEntries(
  groups: HookGroup[],
  currentCommand: string,
  legacyCommand: string,
  event: "sessionStart" | "stop",
  force: boolean
): HookGroup[] {
  return removeHookEntries(groups, entry =>
    isStaleManagedHook(entry, currentCommand, event) ||
    (force && (isHook(entry, currentCommand) || isHook(entry, legacyCommand)))
  );
}

function containsStaleManagedHook(
  groups: HookGroup[],
  currentCommand: string,
  event: "sessionStart" | "stop"
): boolean {
  return groups.some(group => (group.hooks ?? []).some(entry =>
    isStaleManagedHook(entry, currentCommand, event)
  ));
}

function isStaleManagedHook(
  entry: HookEntry,
  currentCommand: string,
  event: "sessionStart" | "stop"
): boolean {
  return isManagedHook(entry, event) && !isHook(entry, currentCommand);
}

function isManagedHook(entry: HookEntry, event: "sessionStart" | "stop"): boolean {
  if (entry.type !== "command" || typeof entry.command !== "string") return false;
  const suffix = event === "sessionStart"
    ? ` hook ${TRIMCTX_MANAGED_HOOK_FLAG} --session-start`
    : ` hook ${TRIMCTX_MANAGED_HOOK_FLAG}`;
  return entry.command.endsWith(suffix);
}

function isHook(entry: HookEntry, command: string): boolean {
  return entry.type === "command" && entry.command === command;
}

function trimctxHookGroup(command: string): HookGroup {
  return { hooks: [{ type: "command", command }] };
}
