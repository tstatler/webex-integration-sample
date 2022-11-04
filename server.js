/*
 * A Webex Integration based on Node.js that initiates an OAuth authorization
 * to finally obtain an API access to make Webex REST API calls on the authenticating user's behalf.
 * 
 * See the [Integrations](https://developer.webex.com/docs/integrations) documentation
 * for more information.
 * 
 */

// Load environment variables from the project's .env file
// require('node-env-file')(__dirname + '/.env');
require('dotenv').config()
const debug = require("debug")("oauth");
const request = require("request");
const express = require('express');
const app = express();

// Check for required environment variables
//
if(!process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.REDIRECT_URI) {
   console.log("One of CLIENT_ID, CLIENT_SECRET or REDIRECT_URI are not specified in .env file, exiting. See README.")
   return;
}

// Step 0: Create an OAuth integration at https://developer.webex.com/my-apps/new/integration 
// with the following settings:
// 
//  * Redirect URI: http://localhost:8080
//  * Scopes: spark:people_read
//
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectURI = process.env.REDIRECT_URI;
// Space-separated list of scopes (e.g. "spark:people_read spark:rooms_read")
const scopes = process.env.SCOPES || "spark:people_read meeting:schedules_read meeting:people_write"; 
const port = process.env.PORT || 8080;

debug(`OAuth integration settings:\n   - CLIENT_ID    : ${clientId}\n   - REDIRECT_URI : ${redirectURI}\n   - SCOPES       : ${scopes}`);

// EJS template configuration
const read = require("fs").readFileSync;
const join = require("path").join;
const ejs = require("ejs");

// Statically serve the "/www" directory.
const path = require('path');
app.use("/", express.static(path.join(__dirname, 'www')));

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
         res.send("<h1>OAuth Integration could not complete</h1><p>User declined data access request, bye.</p>");
         return;
      }

      // Invalid scope 
      if (req.query.error == "invalid_scope") {
         debug("Wrong scope requested, received err: " + req.query.error);
         res.send("<h1>OAuth Integration could not complete</h1><p>This application requested an invalid scope. Make sure your Integration contains all scopes being requested by the app, bye.</p>");
         return;
      }
      
      // Server error
      if (req.query.error == "server_error") {
         debug("Server error, received err: " + req.query.error);
         res.send("<h1>OAuth Integration could not complete</h1><p>Webex sent a server error, bye.</p>");
         return;
      }

      debug("Received err: " + req.query.error);
      res.send("<h1>OAuth Integration could not complete</h1><p>Error case not implemented, bye.</p>");
      return;
   }

   // Check request parameters correspond to the specification
   //
   if ((!req.query.code) || (!req.query.state)) {
      debug("expected code & state query parameters are not present");
      res.send("<h1>OAuth Integration could not complete</h1><p>Unexpected query parameters, ignoring...</p>");
      return;
   }

   // If the state query variable does not match the original values, the process fails.
   //
   if (state != req.query.state) {
      debug("State does not match");
      res.send("<h1>OAuth Integration could not complete</h1><p>State in response does does not match the one in the request, aborting...</p>");
      return;
   }

   // Retrieve access token (expires in 14 days) & refresh token (expires in 90 days)
   // 
   const options = {
      method: "POST",
      url: "https://webexapis.com/v1/access_token",
      headers: {
         "content-type": "application/x-www-form-urlencoded"
      },
      form: {
         grant_type: "authorization_code",
         client_id: clientId,
         client_secret: clientSecret,
         code: req.query.code,
         redirect_uri: redirectURI
      }
   };
   request(options, function (error, response, body) {
      if (error) {
         debug("Could not reach Webex cloud to retrieve access & refresh tokens");
         res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again...</p>");
         return;
      }

      if (response.statusCode != 200) {
         debug("access token not issued with status code: " + response.statusCode);
         switch (response.statusCode) {
            case 400:
               const responsePayload = JSON.parse(response.body);
               res.send("<h1>OAuth Integration could not complete</h1><p>Bad request. <br/>" + responsePayload.message + "</p>");
               break;
            case 401:
               res.send("<h1>OAuth Integration could not complete</h1><p>OAuth authentication error. Ask the service contact to check the secret.</p>");
               break;
            default:
               res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again...</p>");
               break;
         }
         return;
      }

      // Check JSON response payload
      const json = JSON.parse(body);
      if ((!json) || (!json.access_token) || (!json.expires_in) || (!json.refresh_token) || (!json.refresh_token_expires_in)) {
         debug("Could not parse access & refresh tokens");
         res.send("<h1>OAuth Integration could not complete</h1><p>Could not parse API access token. Try again...</p>");
         return;
      }
      debug("OAuth flow completed, fetched tokens: " + JSON.stringify(json));

      // [Optional] Store tokens for future use
      // storeTokens(json.access_token, json.expires_in, json.refresh_token, json.refresh_token_expires_in);

      // OAuth flow has completed
      oauthFlowCompleted(json.access_token, res);
   });
});

// Step 3: Make an Webex REST API call using the API access token, and 
// return a page that includes the user's Webex display name.
// 
// Some optional activities to perform here: 
//   * Associate the issued access token to a user through the state (acting as a Correlation ID)
//   * Store the refresh token (valid 90 days) to reissue later a new access token (details 1 using days)
//
function oauthFlowCompleted(access_token, res) {

   // Retrieve user details using GET https://webexapis.com/v1/people/me
   const options = {
      method: 'GET',
      url: 'https://webexapis.com/v1/people/me',
      headers:
      {
         "authorization": "Bearer " + access_token
      }
   };

   request(options, function (error, response, body) {
      if (error) {
         debug("Could not reach Webex API to retrieve Person's details: " + error);
         res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>");
         return;
      }

      // Check the call is successful
      if (response.statusCode != 200) {
         debug("Could not retrieve your details, /people/me returned: " + response.statusCode);
         res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>");
         return;
      }

      const json = JSON.parse(body);

      if ((!json) || (!json.displayName)) {
         debug("Could not parse Person details: Bad JSON payload or could not find a user displayName property.");
         res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex account details.</p>");
         return;
      }

      // Compile the `display-name.ejs` EJS template with the user's Webex display name 
      // and return the compiled page to the user.
      //
      const str = read(join(__dirname, '/www/display-name.ejs'), 'utf8');
      const compiled = ejs.compile(str)({ "displayName": json.displayName });
      res.send(compiled);
   });
}


// The idea here is to store the access token for future use, and the expiration dates and refresh_token to have Webex cloud issue a new access token

function storeTokens(access_token, expires_in, refresh_token, refresh_token_expires_in) {

   // Store the token in some secure backend
   debug("TODO: store tokens and expiration dates");
   // For demo purpose, we'll NOW ask for a refreshed token
   refreshAccessToken(refresh_token);
}

//
// Example of Refresh token usage
//
function refreshAccessToken(refresh_token) {

   const options = {
      method: "POST",
      url: "https://webexapis.com/v1/access_token",
      headers: {
         "content-type": "application/x-www-form-urlencoded"
      },
      form: {
         grant_type: "refresh_token",
         client_id: clientId,
         client_secret: clientSecret,
         refresh_token: refresh_token
      }
   };
   request(options, function (error, response, body) {
      if (error) {
         debug("Could not reach Webex to refresh access token.");
         return;
      }

      if (response.statusCode != 200) {
         debug("Access token not issued with status code: " + response.statusCode);
         return;
      }

      // Check payload
      const json = JSON.parse(body);
      if ((!json) || (!json.access_token) || (!json.expires_in) || (!json.refresh_token) || (!json.refresh_token_expires_in)) {
         debug("Could not parse response");
         return;
      }

      // Refresh token obtained
      debug("Newly issued tokens: " + JSON.stringify(json));
   });
}


function getLogoutURL(token, redirectURL) {
   const rootURL = redirectURL.substring(0, redirectURL.length - 5);
   return "https://idbroker.webex.com/idb/oauth2/v1/logout?"
      + "goto=" + encodeURIComponent(rootURL)
      + "&token=" + token;
}

// Start the Express app
app.listen(port, function () {
   console.log("Webex OAuth Integration started on port: " + port);
});