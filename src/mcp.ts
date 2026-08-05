import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Database } from "./db.js";
import { normalizeProducts } from "./deals.js";
import type { AppConfig, CatalogResult, SavedAddress } from "./types.js";
import { AppError } from "./types.js";
import { errorStatus, firstDefined, isRecord, redactError, sleep, stringValue } from "./utils.js";

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolEnvelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { message?: string };
  message?: string;
}

function parseTextJson(result: ToolResult): unknown {
  for (const block of result.content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    try {
      return JSON.parse(block.text) as unknown;
    } catch {
      // Some MCP servers include explanatory text before a later JSON block.
    }
  }
  return undefined;
}

export function unwrapToolData(result: ToolResult): Record<string, unknown> {
  const raw = result.structuredContent ?? parseTextJson(result);
  if (!isRecord(raw)) {
    throw new AppError("MCP_RESPONSE_INVALID", "Swiggy returned no structured tool data", 502);
  }
  const envelope = raw as unknown as ToolEnvelope;
  if (result.isError || envelope.success === false) {
    const message = envelope.error?.message ?? envelope.message ?? "Swiggy tool call failed";
    throw new AppError("SWIGGY_TOOL_FAILED", message, 502);
  }
  if (envelope.success === true) {
    if (!isRecord(envelope.data)) {
      throw new AppError("MCP_RESPONSE_INVALID", "Swiggy tool response is missing data", 502);
    }
    return envelope.data;
  }
  // Tolerate servers that return the tool-specific object directly.
  return raw;
}

function isExpiredSessionError(error: unknown): boolean {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return status === 404 || /session.+(?:not found|expired|invalid)|invalid.+session/i.test(message);
}

function classifyMcpError(error: unknown, retryAfterSeconds?: number): AppError {
  if (error instanceof AppError) return error;
  const status = error instanceof StreamableHTTPError ? error.code : errorStatus(error);
  const message = redactError(error);
  if (status === 401 || /unauthori[sz]ed|token.+expired/i.test(message)) {
    return new AppError("AUTH_REQUIRED", "Swiggy authorization is missing or expired", 401);
  }
  if (status === 429) {
    return new AppError("RATE_LIMITED", "Swiggy rate limit reached; the check was not retried", 429, retryAfterSeconds);
  }
  if (status === 403) {
    return new AppError("SWIGGY_ACCESS_DENIED", "Swiggy production access is not enabled for this account", 403);
  }
  return new AppError("SWIGGY_UNAVAILABLE", `Swiggy MCP request failed: ${message}`, 502);
}

async function callToolWithRetry(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  getRetryAfter: () => number | undefined
): Promise<ToolResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (await client.callTool({ name, arguments: args })) as ToolResult;
    } catch (error) {
      lastError = error;
      const classified = classifyMcpError(error, getRetryAfter());
      if (["AUTH_REQUIRED", "RATE_LIMITED", "SWIGGY_ACCESS_DENIED"].includes(classified.code)) {
        throw classified;
      }
      if (attempt < 2) {
        const jitter = Math.floor(Math.random() * 300);
        await sleep(500 * 2 ** attempt + jitter);
      }
    }
  }
  throw classifyMcpError(lastError, getRetryAfter());
}

export class SwiggyMcpClient {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly accessToken: string
  ) {}

  private async execute<T>(operation: (client: Client, retryAfter: () => number | undefined) => Promise<T>): Promise<T> {
    const storedSessionId = await this.db.getSetting("mcp_session_id");

    const connectAndRun = async (sessionId?: string): Promise<T> => {
      let retryAfterSeconds: number | undefined;
      const instrumentedFetch: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        if (response.status === 429) {
          const raw = response.headers.get("retry-after");
          retryAfterSeconds = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
        }
        return response;
      };
      const transport = new StreamableHTTPClientTransport(new URL(this.config.swiggyMcpUrl), {
        sessionId,
        fetch: instrumentedFetch,
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.accessToken}`
          }
        },
        reconnectionOptions: {
          maxReconnectionDelay: 5_000,
          initialReconnectionDelay: 500,
          reconnectionDelayGrowFactor: 2,
          maxRetries: 1
        }
      });
      const client = new Client({ name: "noice-deal-monitor", version: "0.1.0" }, { capabilities: {} });
      try {
        await client.connect(transport);
        if (transport.sessionId && transport.sessionId !== sessionId) {
          await this.db.setSetting("mcp_session_id", transport.sessionId);
        }
        return await operation(client, () => retryAfterSeconds);
      } finally {
        await transport.close().catch(() => undefined);
      }
    };

    try {
      return await connectAndRun(storedSessionId);
    } catch (error) {
      if (!storedSessionId || !isExpiredSessionError(error)) throw classifyMcpError(error);
      await this.db.deleteSetting("mcp_session_id");
      return connectAndRun();
    }
  }

  async getAddresses(): Promise<SavedAddress[]> {
    return this.execute(async (client, getRetryAfter) => {
      const addresses: SavedAddress[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const result = await callToolWithRetry(client, "get_addresses", { page, pageSize: 10 }, getRetryAfter);
        const data = unwrapToolData(result);
        const rawAddresses = Array.isArray(data.addresses) ? data.addresses : [];
        for (const raw of rawAddresses) {
          if (!isRecord(raw)) continue;
          const id = stringValue(firstDefined(raw, ["addressId", "id"]));
          if (!id) continue;
          const label =
            stringValue(
              firstDefined(raw, [
                "label",
                "annotation",
                "displayName",
                "addressType",
                "formattedAddress",
                "address"
              ])
            ) ?? `Saved address ${addresses.length + 1}`;
          addresses.push({ id, label });
        }
        const pagination = isRecord(data.pagination) ? data.pagination : undefined;
        if (pagination?.hasMore !== true) break;
      }
      return addresses;
    });
  }

  async searchNoice(addressId: string): Promise<CatalogResult> {
    return this.execute(async (client, getRetryAfter) => {
      const variants = new Map<string, ReturnType<typeof normalizeProducts>[number]>();
      const productsSeen = new Set<string>();
      const offsetsSeen = new Set<string>();
      let offset = 0;

      for (let page = 0; page < 25; page += 1) {
        const result = await callToolWithRetry(
          client,
          "search_products",
          { addressId, query: "NOICE", offset },
          getRetryAfter
        );
        const data = unwrapToolData(result);
        const directProducts = Array.isArray(data.products) ? data.products : [];
        const normalized = normalizeProducts(directProducts, this.config);
        for (const variant of normalized) {
          variants.set(variant.variantKey, variant);
          productsSeen.add(variant.productId ?? variant.productName);
        }

        const rawNextOffset = data.nextOffset;
        const nextOffset = stringValue(rawNextOffset);
        if (!nextOffset || nextOffset === "0") break;
        if (offsetsSeen.has(nextOffset)) {
          throw new AppError("CATALOG_PAGINATION_LOOP", "Swiggy repeated a catalog pagination cursor", 502);
        }
        offsetsSeen.add(nextOffset);
        const parsedOffset = Number(nextOffset);
        if (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0) {
          throw new AppError("CATALOG_CURSOR_INVALID", "Swiggy returned an invalid catalog cursor", 502);
        }
        offset = parsedOffset;
      }

      if (variants.size === 0) {
        throw new AppError(
          "CATALOG_EMPTY",
          "Swiggy returned no recognizable NOICE variants; existing deal state was preserved",
          502
        );
      }
      return { productCount: productsSeen.size, variants: [...variants.values()] };
    });
  }
}
