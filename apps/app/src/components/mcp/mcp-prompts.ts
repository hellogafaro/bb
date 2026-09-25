export const CREATE_MCP_PROMPT =
  "Add a new MCP to bb. Use `bb mcp registry <query>` to find it in the official registry, or `bb mcp add <name> <url|command>` for a manual server. After adding, run `bb mcp auth <id>` if it needs sign-in, then `bb mcp list` to confirm. The MCP I want is: ";

export function buildMcpEditThreadPrompt({
  name,
  id,
  handle,
}: {
  name: string;
  id: string;
  handle: string;
}): string {
  return `Edit the bb MCP ${JSON.stringify(name)} (handle ${handle}, ID ${id}). Inspect it with \`bb mcp show ${handle}\`. Set headers with \`bb mcp header ${handle} 'Name: value'\`, the agent guide with \`bb mcp guide ${handle} <text>\`, toggle it with \`bb mcp enable ${handle}\` or \`bb mcp disable ${handle}\`, and remove it with \`bb mcp remove ${handle}\`. I want to `;
}
