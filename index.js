const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const fs = require("fs").promises;
const { google } = require("googleapis");
const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, REFRESH_TOKEN } = require("./credentials");
require('./auth');
require('dotenv').config()

const labelName = "Vacation Auto-Reply";


const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];





const app = express();

function isLoggedIn(req, res, next) {
  req.user ? next() : res.sendStatus(401);
}

app.use(session({ secret: process.env.SECRET, resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
  res.send('<a href="/auth/google">Authenticate with Google</a>');
});

app.get('/auth/google',
  passport.authenticate('google', { scope: [ 'email', 'profile' ],
  redirectUri: 'http://localhost:3000/auth/google/callback' }
));

app.get( '/auth/google/callback',
  passport.authenticate( 'google', {
    successRedirect: '/protected',
    failureRedirect: '/auth/google/failure'
  })
);

app.get('/protected', isLoggedIn, async (req, res) => {
  res.send(`Hello ${req.user.displayName}`);
  
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
oAuth2Client.scope = SCOPES.join(' ');
console.log(oAuth2Client);


const repliedUsers = new Set();

async function checkEmailsAndSendReplies() {
  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const res = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
    });
    const messages = res.data.messages;
    
    if (messages && messages.length > 0) {
      for (const message of messages) {
        const email = await gmail.users.messages.get({
          userId: "me",
          id: message.id,
        });
        
        const from = email.data.payload.headers.find((header) => header.name === "From");
        const toHeader = email.data.payload.headers.find((header) => header.name === "To");
        const subject = email.data.payload.headers.find((header) => header.name === "Subject");
        
        const From = from.value;
        const toEmail = toHeader.value;
        const subjectValue = subject.value;
        
        console.log("Email from:", From);
        console.log("To Email:", toEmail);
        
        if (repliedUsers.has(From)) {
          continue;
        }
    
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: message.threadId,
        });
    
        const replies = thread.data.messages.slice(1);
    
        // Check if there are no replies in the thread
        const noReplies = replies.every(reply => reply.from.value !== "YourReplyEmailAddress@example.com");
    
        if (noReplies) {
          await gmail.users.messages.send({
            userId: "me",
            requestBody: {
              raw: await createReplyRaw(toEmail, From, subjectValue),
            },
          });
    
          const labelName = "onVacation";
          await gmail.users.messages.modify({
            userId: "me",
            id: message.id,
            requestBody: {
              addLabelIds: [await createLabelIfNeeded(labelName)],
            },
          });
    
          console.log("Sent reply to email:", From);
          repliedUsers.add(From);
        }
      }
    }
    
  } catch (error) {
    console.error("No unread mails Waiting for new");
  }
}

async function createReplyRaw(from, to, subject) {
  const emailContent = `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\nThank you for your message. I am currently unavailable but will respond as soon as possible.`;
  const base64EncodedEmail = Buffer.from(emailContent).toString("base64");
  return base64EncodedEmail;
}

async function createLabelIfNeeded(labelName) {
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels;

  const existingLabel = labels.find((label) => label.name === labelName);
  if (existingLabel) {
    return existingLabel.id;
  }

  const newLabel = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  return newLabel.data.id;
}

function getRandomInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

setInterval(checkEmailsAndSendReplies, getRandomInterval(45, 120) * 1000);

});



app.get('/auth/google/failure', (req, res) => {
  res.send('Failed to authenticate..');
});















app.listen(3000, () => console.log('listening on port: 3000'));
