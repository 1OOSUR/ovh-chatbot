"use strict";

const assert = require("assert");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const compression = require("compression");
const http = require("http");
const requireDir = require("require-dir");
const routes = requireDir("../routes");
const mongo = require("../providers/orm/nosql/mongo");
const verifyRequestSignature = require("./middlewares/verifyRequest");
const requestLogger = require("../providers/logging/request");
const utilsMiddleware = require("./middlewares/utils");
const lusca = require("lusca");

module.exports = function (config) {
  assert(config, "config for mongo is required");

  mongo.connect(config.mongo);

  let port = config.server.port;
  let app = express();

  http.Server(app);
  app.disable("x-powered-by");
  app.set("json spaces", config.debug ? 2 : 0);
  app.all("/*", (req, res, next) => {
    // CORS headers
    // restrict it to the required domain
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    // Set custom headers for CORS
    res.header("Access-Control-Allow-Headers", "Content-type,Accept");
    if (req.method === "OPTIONS") {
      res.status(200).end();
    } else {
      next();
    }
  });

  app.use(requestLogger(config.server.logType));
  app.use(utilsMiddleware());
  app.use(cors());
  app.use(compression());
  app.use(bodyParser.urlencoded({limit:"50mb",extended: false}));
  app.use(bodyParser.json({limit:"50mb"}));
  app.use(bodyParser.json({ verify: verifyRequestSignature(config) }));
  app.set("view engine", "ejs");

  app.get("/mon/ping", function(req, res) {
    return res.status(200).end(null);
  });

  app.use((req, res, next) => {
    if (process.env.NODE_IS_CLOSING !== "false") {
      return next();
    }
    res.setHeader("Connection", "close");
    let errorApi = res.error(503, "Server is reloading...");

    return res.status(errorApi.statusCode).json(errorApi);
  });

  let api = express.Router();

  app.use(config.server.basePath, api);

  app.use((req, res) => {
    let errorApi = res.error(404, req.originalUrl + " doesn't exist");
    return res.status(errorApi.statusCode).json(errorApi);
  });

  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "preproduction") {
    app.use(lusca({
      csrf: true,
      xframe: "SAMEORIGIN",
      hsts: {
        maxAge: 31536000, //1 year, in seconds
        includeSubDomains: true,
        preload: true
      },
      xssProtection: true,
      nosniff: true
    }));
  }

  Object.keys(routes).forEach((key) => routes[key](api));

  // Start the server
  app.set("port", port);

  return app;
};
