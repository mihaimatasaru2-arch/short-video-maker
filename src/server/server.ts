import http from "http";
import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import path from "path";
import { SAFE_FILENAME_REGEX } from "../types/shorts";
import { ShortCreator } from "../short-creator/ShortCreator";
import { APIRouter } from "./routers/rest";
import { MCPRouter } from "./routers/mcp";
import { logger } from "../logger";
import { Config } from "../config";

export class Server {
  private app: express.Application;
  private config: Config;

  constructor(config: Config, shortCreator: ShortCreator) {
    this.config = config;
    this.app = express();

    // add healthcheck endpoint
    this.app.get("/health", (req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).json({ status: "ok" });
    });

    const apiRouter = new APIRouter(config, shortCreator);
    const mcpRouter = new MCPRouter(shortCreator);
    this.app.use("/api", apiRouter.router);
    this.app.use("/mcp", mcpRouter.router);

    // Serve static files from the UI build
    this.app.use(express.static(path.join(__dirname, "../../dist/ui")));
    this.app.use(
      "/static",
      express.static(path.join(__dirname, "../../static")),
    );

    // Serve user-supplied overlay images and sound effects.
    // Only plain file names are allowed, so nothing outside the folders can be read.
    const safeStatic = (dir: string) => {
      const router = express.Router();
      router.use((req, res, next) => {
        let name: string;
        try {
          name = decodeURIComponent(req.path.replace(/^\//, ""));
        } catch {
          res.status(400).send("Bad file name");
          return;
        }
        if (!SAFE_FILENAME_REGEX.test(name)) {
          res.status(400).send("Bad file name");
          return;
        }
        next();
      });
      router.use(
        express.static(dir, {
          dotfiles: "deny",
          index: false,
          fallthrough: false,
        }),
      );
      return router;
    };
    this.app.use("/overlays", safeStatic(config.overlaysDirPath));
    this.app.use("/sounds", safeStatic(config.soundsDirPath));
    this.app.use("/backgrounds", safeStatic(config.backgroundsDirPath));

    // Serve the React app for all other routes (must be last)
    this.app.get("*", (req: ExpressRequest, res: ExpressResponse) => {
      res.sendFile(path.join(__dirname, "../../dist/ui/index.html"));
    });
  }

  public start(): http.Server {
    const server = this.app.listen(this.config.port, () => {
      logger.info(
        { port: this.config.port, mcp: "/mcp", api: "/api" },
        "MCP and API server is running",
      );
      logger.info(
        `UI server is running on http://localhost:${this.config.port}`,
      );
    });

    server.on("error", (error: Error) => {
      logger.error(error, "Error starting server");
    });

    return server;
  }

  public getApp() {
    return this.app;
  }
}
