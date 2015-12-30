var github = require('./lib/github-additions.js');
var Conduit = require('./lib/phabricator-additions.js');
var async = require("./lib/async-additions.js");
var Octocator = require('./lib/octocator.js');
var config = require('config');

/*
Add this to maniphest.custom-field-definitions:

{
  "github:issueurl": {
    "name": "GitHub Issue URL",
    "type": "link",
    "fulltext": true,
    "edit": true
  }
}
*/

var conduit = new Conduit({
  api: config.get('Phabricator.api'),
  token: config.get('Phabricator.token')
});

github.authenticate({
    type: "oauth",
    token: config.get('GitHub.user.token')
});

var octocator = new Octocator(conduit, github);

var issueQuery = {
  user: config.get('GitHub.repository.user'),
  repo: config.get('GitHub.repository.repo'),
  state: 'all',
  per_page: 100
};
var firstIssueNumber = parseInt(config.get('GitHub.firstIssueNumber'));

var projectName = config.get('Phabricator.project');
var viewPolicy = config.get('Phabricator.viewPolicy');

function log(text) {
  return function() {
    console.log(text);

    // Allows log to act as a pass-through for waterfall operations.
    var args = [].slice.apply(arguments);
    var cb = args.pop();
    args.unshift(null);
    cb.apply(this, args);
  }
}

function mirrorPullRequest(issue, projectphid, mirror_completion_cb) {
  if (!mirror_completion_cb) {
    // projectphid is optional, shift the args.
    mirror_completion_cb = projectphid;
    projectphid = null;
  }

  // Ignore issues
  if (!issue.pull_request
  // Ignore issues before the firstIssueNumber
      || issue.number < firstIssueNumber) {
    mirror_completion_cb();
    return;
  }

  console.log(issue);

  mirror_completion_cb();
  return;

  var linkBackUrl = undefined;

  async.waterfall([
    async.apply(octocator.taskForIssue.bind(octocator), issue, projectphid, viewPolicy),

    // Update the task's status
    function(task, waterfall_next) {
      var state = 'open';
      if (issue.state == 'closed') {
        state = 'resolved';
      }

      if (task.status == state) {
        waterfall_next(null, task);
        return;
      }

      console.log("Updating state of #"+issue.number+" to "+state+"...");
      conduit.exec('maniphest.update', {
        phid: task.phid,
        'status': state
      }, waterfall_next);
    },
    
    // Extract the linkback url
    function(task, watefall_next) {
      linkBackUrl = task.uri;
      watefall_next();
    },

    // Get the auth'd username
    function(waterfall_next) {
      github.user.get({}, function(err, user) {
        waterfall_next(err, user.login);
      });
    },

    // Search for an existing linkback url
    function(username, waterfall_next) {
      var commentsQuery = {
        user: config.get('GitHub.repository.user'),
        repo: config.get('GitHub.repository.repo'),
        number: issue.number,
        per_page: 100
      };
      var linkback_exists = false;
      github.issues.eachComment(commentsQuery, function(comment, commentcb) {
        if (linkback_exists
            || comment.user.login != username
            || comment.body.indexOf(linkBackUrl) == -1) {
          commentcb();
          return;
        }
        
        linkback_exists = true;
        commentcb();

      }, function() {
        waterfall_next(null, linkback_exists);
      });
    },

    // Post the linkback url if one didn't exist
    function(linkback_exists, waterfall_next) {
      if (linkback_exists) {
        waterfall_next(); // Skip this step
        return;
      }

      var commentsQuery = {
        user: config.get('GitHub.repository.user'),
        repo: config.get('GitHub.repository.repo'),
        number: issue.number,
        body: "This issue is also being tracked at "+linkBackUrl+"."
      };
      github.issues.createComment(commentsQuery, waterfall_next);
    }

  ], mirror_completion_cb);
}

async.waterfall([
  log("Looking up Phabricator project '"+projectName+"'..."),
  async.apply(conduit.findProject.bind(conduit), projectName),

  log("Enumerating issues..."),
  function(projectphid, next) {
    if (viewPolicy == 'project') {
      viewPolicy = projectphid;
    }
    github.issues.eachRepoIssue(issueQuery, function(issue, issuecb) {
      mirrorPullRequest(issue, projectphid, issuecb);
    }, next);
  }

], function(err) {
  if (err) {
    console.log(err);
    return;
  }
});