/*
 * A Webex Integration based on Node.js that initiates an OAuth authorization
 * to finally obtain an API access to make Webex REST API calls on the authenticating user's behalf.
 *
 * You'll first need to create an OAuth integration at https://developer.webex.com/my-apps/new/integration
 * The integration should have the following settings:
 *
 *    * Redirect URI: http://localhost:8080
 *    * Scopes: spark:people_read
 *
 * See the [Integrations](https://developer.webex.com/docs/integrations) documentation
 * for more information.
 */

require("dotenv").config();
const debug = require("debug")("oauth");
const fetch = require("node-fetch");
const express = require("express");
var session = require("express-session");
let RedisStore = require("connect-redis")(session);
const app = express();
const crypto = require("crypto");

// Variable session containing API access token
var ssn;

const Redis = require("ioredis");
let redisClient = new Redis();

// Enable express to use the session middleware.
app.use(
  session({
    secret: crypto.randomBytes(64).toString("hex"),
    resave: false,
    saveUninitialized: false,
  })
);

// Create the authorization URL that opens when the user clicks
// 'Start Login'. The base URL is copied from your integration's configuration page
// on the Developer Portal. The following code concatenates the base URL with a
// value for the `state` parameter at the end of the URL.

const state = process.env.STATE || crypto.randomBytes(64).toString("hex");
const initiateURL =
  "https://webexapis.com/v1/authorize?client_id=C97c955d459b1195dd914456c56d7193b3b9db2f96e55226d1bb875c6dc40c16a&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Foauth&scope=spark%3Akms%20spark%3Apeople_read%20spark%3Arooms_read&state=" +
  state;

// Extract client ID, redirect URI, and scopes from authorization URL
var urlParams = new URL(initiateURL).searchParams;
const clientId = urlParams.get("client_id");
const redirectURI = urlParams.get("redirect_uri");
const scopes = urlParams.get("scope");

// Read client secret and port number from environment
const clientSecret = process.env.CLIENT_SECRET;
const port = process.env.PORT || 8080;

// Check for missing configuration variables
//
if (!clientId || !clientSecret || !redirectURI) {
  console.log(
    "Could not parse at least one of client ID, client secret, or redirect URI. See README.md for app usage."
  );
  return;
}

// Output Oauth client settings to console
//
debug(
  `OAuth integration settings:\n   - CLIENT_ID    : ${clientId}\n   - REDIRECT_URI : ${redirectURI}\n   - SCOPES       : ${scopes}`
);

// Compile initiateURL into index.ejs template, which contains a placeholder
// named `link` for the URL.
//
const read = require("fs").readFileSync;
const join = require("path").join;
const str = read(join(__dirname, "/www/index.ejs"), "utf8");
const ejs = require("ejs");
const compiled = ejs.compile(str)({ link: initiateURL }); // inject the link into the template

// Check if the session contain a token. If so, redirect to the compiled display-name.ejs template.

// Express routes
app.get("/index.html", function (req, res) {
  var token = req.session.token;
  if (token != undefined) {
    console.log("session token available: ", token);
    //   getUserInfo(token, res);
  } else {
    console.log(
      "Access token not in session variable, redirecting to home page"
    );
  }
  // res.send("/");

  debug("serving the integration home page (generated from an EJS template)");
  res.send(compiled);
});
app.get("/", function (req, res) {
  res.redirect("/index.html");
});

// Route for redirect URI requested by the Webex OAuth service that contains
// an authorization code as a query parameter. The integration exchanges this
// code for an access token.
// If the exchange succeeds it then returns the compiled display-name.ejs template.
//
app.get("/oauth", async function (req, res) {
  debug("OAuth redirect URL requested.");
  // Error checking
  // User declined access to their data.
  if (req.query.error) {
    if (req.query.error == "access_denied") {
      debug("User declined, received err: " + req.query.error);
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>User declined data access request, bye.</p>"
      );
      return;
    }

    // Invalid scope
    if (req.query.error == "invalid_scope") {
      debug("Wrong scope requested, received err: " + req.query.error);
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>This application requested an invalid scope. Make sure your Integration contains all scopes being requested by the app, bye.</p>"
      );
      return;
    }

    // Server error
    if (req.query.error == "server_error") {
      debug("Server error, received err: " + req.query.error);
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Webex sent a server error, bye.</p>"
      );
      return;
    }

    debug("Received err: " + req.query.error);
    res.send(
      "<h1>OAuth Integration could not complete</h1><p>Error case not implemented, bye.</p>"
    );
    return;
  }

  // Check request parameters correspond to the specification
  //
  if (!req.query.code || !req.query.state) {
    debug("expected code & state query parameters are not present");
    res.send(
      "<h1>OAuth Integration could not complete</h1><p>Unexpected query parameters, ignoring...</p>"
    );
    return;
  }

  // If the state query variable does not match the original values, the process fails.
  //
  if (state != req.query.state) {
    debug("State does not match");
    res.send(
      "<h1>OAuth Integration could not complete</h1><p>State in response does does not match the one in the request, aborting...</p>"
    );
    return;
  }

  // Retrieve access token (expires in 14 days) & refresh token (expires in 90 days)
  //
  var access_token_url = "https://webexapis.com/v1/access_token";

  const params = new URLSearchParams([
    ["grant_type", "authorization_code"],
    ["client_id", clientId],
    ["client_secret", clientSecret],
    ["code", req.query.code],
    ["redirect_uri", redirectURI],
  ]);

  const options = {
    method: "POST",
    headers: {
      "Content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  };

  const response = await fetch(access_token_url, options);
  const data = await response.json();
  console.log(data);

  // request(options, function (error, response, body) {
  //   if (error) {
  //     debug("Could not reach Webex cloud to retrieve access & refresh tokens");
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again...</p>"
  //     );
  //     return;
  //   }

  //   if (response.statusCode != 200) {
  //     debug("access token not issued with status code: " + response.statusCode);
  //     switch (response.statusCode) {
  //       case 400:
  //         const responsePayload = JSON.parse(response.body);
  //         res.send(
  //           "<h1>OAuth Integration could not complete</h1><p>Bad request. <br/>" +
  //             responsePayload.message +
  //             "</p>"
  //         );
  //         break;
  //       case 401:
  //         res.send(
  //           "<h1>OAuth Integration could not complete</h1><p>OAuth authentication error. Ask the service contact to check the secret.</p>"
  //         );
  //         break;
  //       default:
  //         res.send(
  //           "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again...</p>"
  //         );
  //         break;
  //     }
  //     return;
  //   }

  // Check that JSON response payload is valid
  // const json = JSON.parse(body);
  // if (!json) {
  //   debug("Could not parse access & refresh tokens");
  //   res.send(
  //     "<h1>OAuth Integration could not complete</h1><p>Could not parse API access token. Maybe try again.</p>"
  //   );
  //   return;
  // }
  debug("OAuth flow completed, fetched tokens: " + JSON.stringify(data));

  // Store token in session variable for later use
  sess = req.session;
  sess.token = data.access_token;

  // OAuth flow has completed, get user's display name and return in a compiled EJS template.
  getUserInfo(data.access_token, res);
  // res.send('OK')
});

// Log user out and destroy session.
//
app.get("/logout", function (req, res) {
  const rootURL = redirectURI.substring(0, redirectURI.length - 5);
  console.log(`rootURL is ${rootURL}`);
  res.redirect(
    "https://idbroker.webex.com/idb/oauth2/v1/logout?token=" + req.session.token
  );
  req.session.destroy();
});

// Gets list of the users's rooms (spaces).
//
app.get("/listrooms", async function (req, res) {
  // Read access token from session variable, if one exists. If not, send user to login page.
  var token = req.session.token;
  if (token == undefined) {
    console.log(
      "Access token not in session variable, redirecting to home page."
    );
    res.send("/");
  }

  var listRoomsURL = "https://webexapis.com/v1/rooms"

  // Retrieves a list of spaces (rooms) to which the user belongs.
  // GET https://webexapis.com/v1/rooms

  const options = {
    method: "GET",
    headers: {
      authorization: "Bearer " + token,
    },
  };
  // const options = {
  //   method: "POST",
  //   headers: {
  //     "Content-type": "application/x-www-form-urlencoded",
  //   },
  //   body: params,
  // };

  const response = await fetch(listRoomsURL, options);
  const data = await response.json();
  console.log(data);
  const str = read(join(__dirname, "/www/list-rooms.ejs"), "utf8");
  const compiled = ejs.compile(str)({ rooms: data.items });
  res.send(compiled);

  // request(options, function (error, response, body) {
  //   if (error) {
  //     debug("Could not get a list of user's rooms: " + error);
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex rooms.</p>"
  //     );
  //     return;
  //   }

  //   // Check the call is successful
  //   if (response.statusCode != 200) {
  //     debug(
  //       "Could not retrieve your details, /listrooms returned: " +
  //         response.statusCode
  //     );
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex rooms.</p>"
  //     );
  //     return;
  //   }

  //   const json = JSON.parse(body);
  //   console.log(json);

  //   if (!json || !json.items) {
  //     debug(
  //       "Could not parse rooms details: Bad JSON payload or could not find a rooms property."
  //     );
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex rooms.</p>"
  //     );
  //     return;
  //   }
    // Compile the `display-name.ejs` EJS template with the user's Webex display name
    // and return the compiled page to the user.
    //
  });

// -------------------------------------------------------------
// Statically serve the "/www" directory
// Do not move the two lines of code below, as this
// exact precedence order is required for the static and dynamic HTML generation
// to work correctly all together.
//
const path = require("path");
app.use("/", express.static(path.join(__dirname, "www")));

// Step 2: Handle the redirect URL requested by the Webex Oauth server.
// This code processes the authorization code passed as a query parameter
// and exchanges it for an access token.
//

// Step 3: Make an Webex REST API call using the API access token, and
// return a page that includes the user's Webex display name.
//
//
async function getUserInfo(access_token, res) {
  // Configure HTTP request options

  var peopleApiUrl = "https://webexapis.com/v1/people/me";
  const options = {
    method: "GET",
    headers: {
      authorization: "Bearer " + access_token,
    },
  };

  // // Make API request
  const response = await fetch(peopleApiUrl, options);
  const data = await response.json();

  const str = read(join(__dirname, "/www/display-name.ejs"), "utf8");
  const compiled = ejs.compile(str)({ displayName: data.displayName });
  res.send(compiled);

  // var fetch(options, function (error, response, body) {
  //   if (error) {
  //     debug("Could not reach Webex API to retrieve Person's details: " + error);
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
  //     );
  //     return;
  //   }

  //   if (response.statusCode != 200) {
  //     // Check the that call was successful
  //     debug(
  //       "Could not retrieve user details, /people/me returned: " +
  //         response.statusCode
  //     );
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
  //     );
  //     return;
  //   }

  //   const json = JSON.parse(body);

  //   if (!json || !json.displayName) {
  //     debug(
  //       "Could not parse Person details: Bad JSON payload or could not find a user displayName property."
  //     );
  //     res.send(
  //       "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
  //     );
  //     return;
  //   }

  // Compile the `display-name.ejs` EJS template with the user's Webex display name
  // and return it to the user.
}

async function doFetch(url, options) {
  class HTTPResponseError extends Error {
    constructor(response) {
      super(`HTTP Error Response: ${response.status} ${response.statusText}`);
      this.response = response;
    }
  }

  const checkStatus = (response) => {
    if (response.ok) {
      // response.status >= 200 && response.status < 300
      return response;
    } else {
      throw new HTTPResponseError(response);
    }
  };

  const response = await fetch("https://httpbin.org/status/400");

  try {
    checkStatus(response);
  } catch (error) {
    console.error(error);

    const errorBody = await error.response.text();
    console.error(`Error body: ${errorBody}`);
  }
}

// Start the Express app
app.listen(port, function () {
  console.log(`Webex OAuth Integration started on http://localhost:${port}`);
});
