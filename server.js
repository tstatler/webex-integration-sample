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
const request = require("request");
const express = require("express");
var session = require("express-session");
const app = express();
const crypto = require("crypto");

// Variable session containing API access token
var ssn;

// Enable express-session
app.use(
  session({
    secret: crypto.randomBytes(64).toString("hex"),
    resave: false,
    saveUninitialized: false,
  })
);

// Check for required environment variables
if (
  !process.env.CLIENT_ID ||
  !process.env.CLIENT_SECRET ||
  !process.env.REDIRECT_URI
) {
  console.log(
    "One of CLIENT_ID, CLIENT_SECRET or REDIRECT_URI are not specified in .env file, exiting. See README."
  );
  return;
}

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectURI = process.env.REDIRECT_URI;
// Space-separated list of scopes (e.g. "spark:people_read spark:rooms_read")
const scopes = process.env.SCOPES || "spark:people_read";
const port = process.env.PORT || 8080;

// Configure the URL used to initiate the authorization flow.
// The `state` parameter is optional but recommended. It can be used for security and correlation purposes.

const state = process.env.STATE || crypto.randomBytes(64).toString("hex");

// Base authorization URI copied from Developer Portal

const initiateURL =
  "https://webexapis.com/v1/authorize?client_id=C909b987b64167258774e532d595702ef864a35f7614678dbe4046056daf67d63&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Foauth&scope=spark%3Akms%20spark%3Apeople_read%20spark%3Arooms_read%20spark%3Arooms_write&state=" +
  state;

// Output oauth client settings

debug(
  `OAuth integration settings:\n   - CLIENT_ID    : ${clientId}\n   - REDIRECT_URI : ${redirectURI}\n   - SCOPES       : ${scopes}`
);

// Compile initiateURL into index.ejs template

const read = require("fs").readFileSync;
const join = require("path").join;
const str = read(join(__dirname, "/www/index.ejs"), "utf8");
const ejs = require("ejs");
const compiled = ejs.compile(str)({ link: initiateURL }); // inject the link into the template

app.get("/index.html", function (req, res) {
  debug("serving the integration home page (generated from an EJS template)");
  res.send(compiled);
});
app.get("/", function (req, res) {
  res.redirect("/index.html");
});

// Logs user out and destroys session.
app.get("/logout", function (req, res) {
  const rootURL = redirectURI.substring(0, redirectURI.length - 5);
  console.log(`rootURL is ${rootURL}`);
  res.redirect(
    "https://idbroker.webex.com/idb/oauth2/v1/logout?token=" + req.session.token
  );
  req.session.destroy();
});

app.get("/listrooms", function (req, res) {
  // Get access token from session variable, if one exists. If not, send user to login page.
  var token = req.session.token;
  if (token === undefined) {
    console.log("session token available: ", token);
  } else {
    console.log("Access token not in session variable", token);
  }

  // Retrieve list of spaces (rooms) to which the authenticated user belongs
  // GET https://webexapis.com/v1/rooms

  const options = {
    method: "GET",
    url: "https://webexapis.com/v1/rooms",
    headers: {
      authorization: "Bearer " + token,
    },
  };

  request(options, function (error, response, body) {
    if (error) {
      debug("Could not get a list of user's rooms: " + error);
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
      );
      return;
    }

    // Check the call is successful
    if (response.statusCode != 200) {
      debug(
        "Could not retrieve your details, /listrooms returned: " +
          response.statusCode
      );
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
      );
      return;
    }

    const json = JSON.parse(body);
    console.log(json);

    if (!json || !json.items) {
      debug(
        "Could not parse rooms details: Bad JSON payload or could not find a rooms property."
      );
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex rooms.</p>"
      );
      return;
    }
    // Compile the `display-name.ejs` EJS template with the user's Webex display name
    // and return the compiled page to the user.
    //
    const str = read(join(__dirname, "/www/list-rooms.ejs"), "utf8");
    const compiled = ejs.compile(str)({ rooms: json.items });
    res.send(compiled);
  });
});

// -------------------------------------------------------------
// Statically serve the "/www" directory
// WARNING: Do not move the 2 lines of code below, as we need this exact precedence order for the static and dynamic HTML generation to work correctly all together
//          If the section above is commented, the static index.html page will be served instead of the EJS template.
const path = require("path");
app.use("/", express.static(path.join(__dirname, "www")));

// Step 2: Handle the redirect URL requested by the Webex Oauth server.
// This code processes the authorization code passed as a query parameter
// and exchanges it for an access token.
//
app.get("/oauth", function (req, res) {
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
  const options = {
    method: "POST",
    url: "https://webexapis.com/v1/access_token",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: req.query.code,
      redirect_uri: redirectURI,
    },
  };
  request(options, function (error, response, body) {
    if (error) {
      debug("Could not reach Webex cloud to retrieve access & refresh tokens");
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again...</p>"
      );
      return;
    }

    if (response.statusCode != 200) {
      debug("access token not issued with status code: " + response.statusCode);
      switch (response.statusCode) {
        case 400:
          const responsePayload = JSON.parse(response.body);
          res.send(
            "<h1>OAuth Integration could not complete</h1><p>Bad request. <br/>" +
              responsePayload.message +
              "</p>"
          );
          break;
        case 401:
          res.send(
            "<h1>OAuth Integration could not complete</h1><p>OAuth authentication error. Ask the service contact to check the secret.</p>"
          );
          break;
        default:
          res.send(
            "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again...</p>"
          );
          break;
      }
      return;
    }

    // Check JSON response payload
    const json = JSON.parse(body);
    if (
      !json ||
      !json.access_token ||
      !json.expires_in ||
      !json.refresh_token ||
      !json.refresh_token_expires_in
    ) {
      debug("Could not parse access & refresh tokens");
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Could not parse API access token. Try again...</p>"
      );
      return;
    }
    debug("OAuth flow completed, fetched tokens: " + JSON.stringify(json));

    // Store token in session variable for later use
    sess = req.session;
    sess.token = json.access_token;

    // OAuth flow has completed, get user's display name and return it to them
    getUserInfo(json.access_token, res);
  });
});

// Step 3: Make an Webex REST API call using the API access token, and
// return a page that includes the user's Webex display name.
//
// Some optional activities to perform here:
//   * Associate the issued access token to a user through the state (acting as a Correlation ID)
//   * Store the refresh token (valid 90 days) to reissue later a new access token (details 1 using days)
//
function getUserInfo(access_token, res) {
  // Configure HTTP request options

  const options = {
    method: "GET",
    url: "https://webexapis.com/v1/people/me",
    headers: {
      authorization: "Bearer " + access_token,
    },
  };

  // Make API request

  request(options, function (error, response, body) {
    if (error) {
      debug("Could not reach Webex API to retrieve Person's details: " + error);
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
      );
      return;
    }

    if (response.statusCode != 200) {
      // Check the that call was successful
      debug(
        "Could not retrieve user details, /people/me returned: " +
          response.statusCode
      );
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
      );
      return;
    }

    const json = JSON.parse(body);

    if (!json || !json.displayName) {
      debug(
        "Could not parse Person details: Bad JSON payload or could not find a user displayName property."
      );
      res.send(
        "<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>"
      );
      return;
    }

    // Compile the `display-name.ejs` EJS template with the user's Webex display name
    // and return it to the user.

    const str = read(join(__dirname, "/www/display-name.ejs"), "utf8");
    const compiled = ejs.compile(str)({ displayName: json.displayName });
    res.send(compiled);
  });
}

// Start the Express app
app.listen(port, function () {
  console.log(`Webex OAuth Integration started on http://localhost:${port}`);
});
