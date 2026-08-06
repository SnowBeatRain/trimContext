export const TRIMCTX_HOOK_COMMAND = "trimctx hook";
export const TRIMCTX_SESSION_ENV_COMMAND = "trimctx hook --session-start";

export type HookSettings = Record<string, unknown>;

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
  options: { force?: boolean } = {}
): HookSettingsPlan {
  const settings = requiredObject(input, "Claude settings");
  const hooks = settings.hooks === undefined
    ? {}
    : requiredObject(settings.hooks, "Claude settings hooks");
  const sessionStartHooks = eventGroups(hooks, "SessionStart");
  const stopHooks = eventGroups(hooks, "Stop");
  const hasSessionEnvHook = containsHook(sessionStartHooks, TRIMCTX_SESSION_ENV_COMMAND);
  const hasTrimctxHook = containsHook(stopHooks, TRIMCTX_HOOK_COMMAND);

  if (hasSessionEnvHook && hasTrimctxHook && !options.force) {
    return { status: "already_installed" };
  }

  const newSessionStartHooks = options.force
    ? removeHookEntries(sessionStartHooks, TRIMCTX_SESSION_ENV_COMMAND)
    : [...sessionStartHooks];
  const newStopHooks = options.force
    ? removeHookEntries(stopHooks, TRIMCTX_HOOK_COMMAND)
    : [...stopHooks];

  if (!hasSessionEnvHook || options.force) {
    newSessionStartHooks.push(trimctxHookGroup(TRIMCTX_SESSION_ENV_COMMAND));
  }
  if (!hasTrimctxHook || options.force) {
    newStopHooks.push(trimctxHookGroup(TRIMCTX_HOOK_COMMAND));
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

export function plannedHookSettings(): HookSettings {
  return {
    hooks: {
      SessionStart: [trimctxHookGroup(TRIMCTX_SESSION_ENV_COMMAND)],
      Stop: [trimctxHookGroup(TRIMCTX_HOOK_COMMAND)]
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

function removeHookEntries(groups: HookGroup[], command: string): HookGroup[] {
  return groups.flatMap((group) => {
    if (!group.hooks) return [group];
    const remaining = group.hooks.filter((entry) => !isHook(entry, command));
    if (remaining.length === group.hooks.length) return [group];
    if (remaining.length === 0) return [];
    return [{ ...group, hooks: remaining }];
  });
}

function isHook(entry: HookEntry, command: string): boolean {
  return entry.type === "command" && entry.command === command;
}

function trimctxHookGroup(command: string): HookGroup {
  return { hooks: [{ type: "command", command }] };
}
