"use strict";

var GitHubApi = require("github");
var async = require("async");

var github = new GitHubApi({
  version: "3.0.0",
  protocol: "https",
  host: "api.github.com",
  pathPrefix: "",
  timeout: 5000,
  headers: {
    "user-agent": "Github issues->Phabricator maniphest"
  }
});

github.paginateEach = function(query, page_fetcher, work, completion) {
  var paginatedQuery = query;
  paginatedQuery['page'] = 0;
  
  var link = undefined;

  async.doWhilst(function(whilst_cb) {
    page_fetcher(paginatedQuery, function(err, items) {
      if (err) {
        whilst_cb(err);
        return;
      }
      link = items.meta.link;
      async.eachLimit(items, 10, work, whilst_cb);
    });

  }, function() {
    paginatedQuery['page'] = paginatedQuery['page'] + 1;
    return /page=([0-9]+)>; rel="next"/.exec(link) !== null;
  }, completion);
};

github.issues.eachRepoIssue = function(query, work, completion) {
  github.paginateEach(query, github.issues.repoIssues, work, completion);
};

github.issues.eachComment = function(query, work, completion) {
  github.paginateEach(query, github.issues.getComments, work, completion);
};

module.exports = github;
