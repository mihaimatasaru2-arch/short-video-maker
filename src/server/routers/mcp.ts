import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import z from "zod";

import { ShortCreator } from "../../short-creator/ShortCreator";
import { logger } from "../../logger";
import { renderConfig, sceneInput } from "../../types/shorts";

export class MCPRouter {
  router: express.Router;
  shortCreator: ShortCreator;
  transports: { [sessionId: string]: SSEServerTransport } = {};
  mcpServer: McpServer;
  constructor(shortCreator: ShortCreator) {
    this.router = express.Router();
    this.shortCreator = shortCreator;

    this.mcpServer = new McpServer({
      name: "Short Creator",
      version: "0.0.1",
      capabilities: {
        resources: {},
        tools: {},
      },
    });

    this.setupMCPServer();
    this.setupRoutes();
  }

  private setupMCPServer() {
    this.mcpServer.tool(
      "get-video-status",
      "Get the status of a video (ready, processing, failed)",
      {
        videoId: z.string().describe("The ID of the video"),
      },
      async ({ videoId }) => {
        const status = this.shortCreator.status(videoId);
        return {
          content: [
            {
              type: "text",
              text: status,
            },
          ],
        };
      },
    );

    this.mcpServer.tool(
      "list-voices",
      "List the narration voices available: free local Kokoro voices and the ElevenLabs voices in the user's account (use these exact names in config.voice, e.g. 'elevenlabs:Hope').",
      {},
      async () => {
        const voices = await this.shortCreator.ListAllVoices();
        return {
          content: [{ type: "text", text: JSON.stringify(voices, null, 2) }],
        };
      },
    );

    this.mcpServer.tool(
      "create-short-video",
      "Create a short video from a list of scenes",
      {
        scenes: z.array(sceneInput).describe("Each scene to be created"),
        config: renderConfig.describe("Configuration for rendering the video"),
      },
      async ({ scenes, config }) => {
        let videoId: string;
        try {
          videoId = this.shortCreator.addToQueue(scenes, config);
        } catch (error: unknown) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: videoId,
            },
          ],
        };
      },
    );
  }

  private setupRoutes() {
    this.router.get("/sse", async (req, res) => {
      logger.info("SSE GET request received");

      const transport = new SSEServerTransport("/mcp/messages", res);
      this.transports[transport.sessionId] = transport;
      res.on("close", () => {
        delete this.transports[transport.sessionId];
      });
      await this.mcpServer.connect(transport);
    });

    this.router.post("/messages", async (req, res) => {
      logger.info("SSE POST request received");

      const sessionId = req.query.sessionId as string;
      const transport = this.transports[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No transport found for sessionId");
      }
    });
  }
}
