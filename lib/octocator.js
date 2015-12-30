"use strict";

var async = require("./async-additions.js");

var Octocator = module.exports = function(conduit, github) {
  this.conduit = conduit;
  this.github = github;
};

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

// existing_task is optional. If provided, tasks won't be searched/created.
Octocator.prototype.taskForIssue = function(issue, projectphid, viewPolicy, existing_task, task_cb) {
  if (!task_cb) {
    task_cb = existing_task;
    existing_task = null;
  }

  var comment =
      "!![[" + issue.html_url + " | This is a child task of GitHub issue #" + issue.number + "]]!!."
      + "\nPlease note that changes made to this task **will not be reflected on GitHub**.";
      
  var sanitized_description = issue.body;
  if (sanitized_description.length > 700) {
    sanitized_description = sanitized_description.substring(0, 700)+'...\n\n---\n!!Issue description was truncated due to length.!!';
  }

  var data = {
    title: issue.title,
    description: sanitized_description + "\n\n---\n" + comment,
    viewPolicy: viewPolicy,
    editPolicy: viewPolicy,
    ccPHIDs: [],
    auxiliary: {
      "std:maniphest:github:issueurl": issue.html_url
    }
  };
  if (projectphid) {
    data['projectPHIDs'] = [projectphid];
  }

  var conduit = this.conduit;
  
  var work = [];
  
  if (!existing_task) {
    work.push.apply(work, [
      log("Checking for existence of #"+issue.number+"..."),
      async.apply(conduit.exec.bind(conduit), 'maniphest.query', {
        fullText: '"'+issue.html_url+'"'
      }),

      function(result, waterfall_next) {
        async.filter(result, function(item, condition) {
          condition(item.auxiliary['std:maniphest:github:issueurl'] == issue.html_url);
        }, function(matches) {
          waterfall_next(null, matches);
        });
      },

      function(matches, waterfall_next) {
        if (matches.length == 0) {
          waterfall_next(null, null);
          return;
        } else if (matches.length == 1) {
          waterfall_next(null, matches[0]);
          return;
        }

        matches.sort(function(a,b) {
          if (a.id < b.id) return -1;
          if (a.id > b.id) return 1;
          return 0;
        });

        // Everything after the first task is a duplicate
        async.each(matches.slice(1), function(task, eachcb) {
          var data = {
            phid: task.phid,
            title: "github-bot duplicate",
            description: '',
            auxiliary: {
              "std:maniphest:github:issueurl": ''
            },
            'status': 'duplicate'
          };
          console.log("Marking "+task.id+" as a duplicate.");
          conduit.exec('maniphest.update', data, eachcb);

        }, function(err) {
          if (err) {
            waterfall_next(err);
            return;
          }
          waterfall_next(null, matches[0]);
        });
      },
    ]);

  } else {
    work.push(async.constant(existing_task));
  }

  work.push.apply(work, [
    log('Mirroring issue #'+issue.number+'...'),
    function(task, waterfall_next) {
      var command = (task === null) ? 'maniphest.createtask' : 'maniphest.update';
      if (task) {
        data['phid'] = task.phid;
      }
      conduit.exec(command, data, function(err, task) {
        if (err && err.code == 400) {
          // Assume that the description was the problem and try again.
          data['description'] = comment;
          conduit.exec(command, data, waterfall_next);
          return;
        }
        waterfall_next(err, task);
      });
    }
  ]);

  async.waterfall(work, task_cb);
};

Octocator.prototype.mirrorIssue = function(issue, viewPolicy, user, repo, projectphid, mirror_completion_cb) {
  if (!mirror_completion_cb) {
    // projectphid is optional, shift the args.
    mirror_completion_cb = projectphid;
    projectphid = null;
  }

  // Ignore pull requests
  if (issue.pull_request) {
    mirror_completion_cb();
    return;
  }

  var linkBackUrl = undefined;
  var conduit = this.conduit;
  var github = this.github;
  var githubUsername = undefined;
  var taskId = undefined;
  var self = this;

  async.waterfall([

    // Get the auth'd username
    function(waterfall_next) {
      github.user.get({}, function(err, user) {
        githubUsername = user.login;
        waterfall_next(err);
      });
    },

    // Phabricator's full text search often lags behind by several seconds. This can result in
    // tasks being duplicated if this function is called multiple times in quick succession.
    // GitHub, on the other hand, will immediately return comments for a given issue. Let's search
    // the comments for a linkback url first.
    function(waterfall_next) {
      var commentsQuery = {
        user: user,
        repo: repo,
        number: issue.number,
        per_page: 100
      };
      github.issues.eachComment(commentsQuery, function(comment, commentcb) {
        if (taskId || comment.user.login != githubUsername) {
          commentcb();
          return;
        }

        // This can easily break if the URL has a /T anywhere in it. It may be wise to store more
        // structured information in the comment.
        var re = /\/T([0-9]+)/;
        var m;
        if ((m = re.exec(comment.body)) !== null) {
          if (m.index === re.lastIndex) {
            re.lastIndex++;
          }

          taskId = m[1];
        }
        commentcb();

      }, function() {
        if (taskId) {
          conduit.exec('maniphest.query', {
            ids: [taskId]
          }, function(err, result) {
            if (err) {
              waterfall_next(err);
              return;
            }
            
            var existing_task = undefined;

            for (var phid in result) {
              existing_task = result[phid];
              break;
            }

            self.taskForIssue(issue, projectphid, viewPolicy, existing_task, waterfall_next);
          });
        } else {
          self.taskForIssue(issue, projectphid, viewPolicy, waterfall_next);
        }
      });
    },

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
    function(task, waterfall_next) {
      if (taskId) {
        // Already extract task id from GitHub, so no need to make a comment on GitHub.
        async.break(waterfall_next);
        return;
      }

      linkBackUrl = task.uri;
      waterfall_next();
    },

    // Search for an existing linkback comment
    function(waterfall_next) {
      var commentsQuery = {
        user: user,
        repo: repo,
        number: issue.number,
        per_page: 100
      };
      var linkback_exists = false;
      github.issues.eachComment(commentsQuery, function(comment, commentcb) {
        if (linkback_exists
            || comment.user.login != githubUsername
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
        user: user,
        repo: repo,
        number: issue.number,
        body: "This issue is also being tracked at "+linkBackUrl+"."
      };
      github.issues.createComment(commentsQuery, waterfall_next);
    }

  ], mirror_completion_cb);
}
