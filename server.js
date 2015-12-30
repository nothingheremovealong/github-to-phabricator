var github = require('./lib/github-additions.js');
var Conduit = require('./lib/phabricator-additions.js');
var async = require("./lib/async-additions.js");
var Octocator = require('./lib/octocator.js');
var config = require('config');

var conduit = new Conduit({
  api: config.get('Phabricator.api'),
  token: config.get('Phabricator.token')
});
github.authenticate({
  type: "oauth",
  token: config.get('GitHub.user.token')
});
var octocator = new Octocator(conduit, github);
var projectName = config.get('Phabricator.project');
var firstIssueNumber = parseInt(config.get('GitHub.firstIssueNumber'));

var http = require('http');
var createHandler = require('github-webhook-handler');
var handler = createHandler({ path: '/webhook', secret: config.get('GitHub.webhook.secret') });
var port = 80;

http.createServer(function (req, res) {
  handler(req, res, function (err) {
    res.statusCode = 404
    res.end('no such location')
  })
}).listen(port)

handler.on('error', function (err) {
  console.error('Error:', err.message)
});
/*
handler.on('*', function (event) {
  console.log(event);
});
*/
function syncIssue(issue) {
  async.waterfall([
    async.apply(conduit.findProject.bind(conduit), projectName),

    function(projectphid, next) {
      var viewPolicy = config.get('Phabricator.viewPolicy');
      if (viewPolicy == 'project') {
        viewPolicy = projectphid;
      }
      if (issue.number < firstIssueNumber) {
        next();
        return;
      }

      octocator.mirrorIssue(issue,
        viewPolicy,
        config.get('GitHub.repository.user'),
        config.get('GitHub.repository.repo'),
        projectphid,
        next);
    }

  ], function(err) {
    if (err) {
      console.log(err);
      return;
    }
  });
}

handler.on('issue_comment', function (event) {
  var issue = event.payload.issue;

  github.user.get({}, function(err, user) {
    if (user.login == event.payload.comment.user.login) {
      return; // Ignore comments by the bot
    }

    console.log("Comment made on issue #"+issue.number+"...");
    syncIssue(issue);
  });
});

handler.on('issues', function (event) {
  var issue = event.payload.issue;
  console.log("Issue #"+issue.number+" was "+event.payload.action+"...");
  syncIssue(issue);
});
