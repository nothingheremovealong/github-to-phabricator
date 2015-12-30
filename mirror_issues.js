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

async.waterfall([
  log("Looking up Phabricator project '"+projectName+"'..."),
  async.apply(conduit.findProject.bind(conduit), projectName),

  log("Enumerating issues..."),
  function(projectphid, next) {
    if (viewPolicy == 'project') {
      viewPolicy = projectphid;
    }
    github.issues.eachRepoIssue(issueQuery, function(issue, issuecb) {
      if (issue.number < firstIssueNumber) {
        issuecb();
        return;
      }

      octocator.mirrorIssue(issue,
        viewPolicy,
        config.get('GitHub.repository.user'),
        config.get('GitHub.repository.repo'),
        projectphid,
        issuecb);
    }, next);
  }

], function(err) {
  if (err) {
    console.log(err);
    return;
  }
});