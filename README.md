"Camel" is a blogging platform written in [Node.js][n]. It is designed to be fast, simple, and lean.

[n]: http://nodejs.org/

# Design Goals

More specifically, the design goals were:

* Easy posting using [Markdown][m]
* Basic metadata, stored in each file
* Basic templating, with a site header/footer and post header stored separately from content
* Extremely quick performance, by caching rendered HTML output
* Support for two RSS feeds:
    * The default one, where link posts open on the target website
    * The alternate feed, where link posts open on this website
* Optional automatic posts to Twitter

[m]: http://daringfireball.net/projects/markdown

# Approach

Camel is neither a static blogging platform nor a truly dynamic one. It is a little
from column A, and a little from column B. The first time a post is loaded, it is rendered
by converting from Markdown to HTML, and then postprocessed by adding headers & footer, as well
as making metadata replacements. Upon a completed render, the resultant HTML is stored
and used from that point forward.

# Usage

## Installation

1. Install [Node][n] & [npm][npm]
2. Clone the repository
3. Get all the dependencies using NPM: `npm install`
4. `node ./camel.js`

[npm]: https://www.npmjs.org/

## Configuration

* There's a group of "statics" near the top of the file
* The RSS parameters in the `generateRss` function will need to be modified.
* The headers/footers:
    * `header.html` - site header; shown at the top of every page
    * `footer.html` - site footer; shown at the bottom of every page
    * `defaultTags.html` - default metadata; merged with page metadata (page wins)
    * `postHeader.html` - post header; shown at the top of every post not marked with `@@ HideHeader=true`. See below.
    * `rssFooter.html` - RSS footer; intended to only show anything on the bottom of
       link posts in RSS, but is appended to all RSS entries.
* It's worth noting there are some [Handlebars][hb] templates in use:
    * `index.md`
        * `@@ DayTemplate` - used to render a day
        * `@@ ArticlePartial` – used to render a single article in a day
        * `@@ FooterTemplate` - used to render pagination
    * `postHeader.html` - placed on every post between the site header and post content
    * `rssFooter.html` - placed on the bottom of every RSS item
* If you'd like to have Camel post to Twitter, set four environment variables (see below)
* If you'd like to support endpoints that require [basic auth](https://en.wikipedia.org/wiki/Basic_access_authentication),
  set two environment variables (see below).

[hb]: http://handlebarsjs.com/

## Files

To use Camel, the following files are required:

    Root
    +-- camel.js
    |   Application entry point
    +-- package.json
    |   Node package file
    +-- templates/
    |     +-- defaultTags.html
    |     |   Site-level default tags, such as the site title
    |     +-- header.html
    |     |   Site header (top of every page)
    |     +-- footer.html
    |     |   Site footer (bottom of every page)
    |     +-- postHeader.html
    |     |   Post header (top of every post, after the site header. Handlebars template.)
    |     `-- rssFooter.html
    |         RSS footer (at the end of every RSS item)
    +-- public/
    |     `-- Any static files, such as images/css/javascript/etc.
    `-- posts/
        All the pages & posts are here. Pages in the root, posts ordered by day. For example:
        +-- index.md
        |   Root file; note that DayTemplate, ArticlePartial, and FooterTemplate are
        |   all Handlebars templates
        +-- about.md
        |   Sample about page
        +-- 2014/
        |   Year
        |     +-- 4/
        |     |   Month
        |     |   +-- 29/
        |     |   |   Day
        |     |   |    `-- some-blog-post.md
        |     |   `-- 30/
        |     |        +-- some-other-post.md
        |     |        `-- yet-another-post.md
        |     `-- 5/
        |         +-- 1/
        |         |   `-- newest-blog-post.md
        |         `-- 5/
        |             `-- some-cool-website.redirect
        `-- etc.

For each post, metadata is specified at the top, and can be leveraged in the body. For example:

    @@ Title=Test Post
    @@ Date=2014-05 17:50
    @@ Description=This is a short description used in Twitter cards and Facebook Open Graph.
    @@ Image=http://somehost.com/someimage.png

    This is a *test post* entitled "@@Title@@".

The title and date are required. Any other metadata, such as `Description` and `Image`, is optional.

### Link Posts
As of version 1.3, link posts are supported. To create a link post, simply add a `Link`
metadata item:

    @@ Title=Sample Link Post
    @@ Date=2015-02-06 12:00
    @@ Link=http://www.vt.edu/

    This is a sample *link* post.

The presence of a `Link` metadata item indicates this is a link post. The formatting for
link and non-link post headers is controlled by the `postHeader.html` template.

In the RSS feed, the link for a link post is the *external* link. Thus, `rssFooter.html`
is used to add a permalink to the Camel site at the bottom of each link post. It is
important to note that this footer is shown on *every* post; it is up to the footer to
decide whether or not to show anything for the post in question. The example included in
this repo behaves as intended.

### Redirects

As of version 1.1, redirects are supported. To do so, a specially formed file is placed
in the `posts/` tree. The file should have two lines; the first should be the status code
of the redirect ([301][301] or [302][302]). The second line should be the target URL.

Suppose you wanted to redirect `/2014/12/10/source` to `/2014/12/10/destination`. You will
add the file `/posts/2014/12/10/source.redirect`; it will contain the following:

    302
    /2014/12/10/destination

Redirects to both internal and external URLs are supported. Providing an invalid status
code will result in that status code being used blindly, so tread carefully.

[301]: http://en.wikipedia.org/wiki/HTTP_301
[302]: http://en.wikipedia.org/wiki/HTTP_302

### Automatic tweets

As of version 1.4, Camel can automatically tweet when a new post is discovered. This
requires a custom app to be set up for your blog; you can set this up [at Twitter][tdev].
To enable, specify four environment variables to correspond to those Twitter issues:

   * `TWITTER_CONSUMER_KEY`
   * `TWITTER_CONSUMER_SECRET`
   * `TWITTER_ACCESS_TOKEN`
   * `TWITTER_TOKEN_SECRET`

Additionally, a couple of variables up at the top of the file need to be set:

   * `twitterUsername` - the username of the Twitter account that will be tweeted from.
   * `twitterClientNeedle` - a portion of the client's name

Upon startup, and when the caches are cleaned, Camel will look at the most recent tweets
by the account in question by the app with a name that contains `twitterClientNeedle`. It
will look to see the most recent URL tweeted. If the URL does not match the most recent
post's URL, then a tweet is fired off.

[tdev]: https://apps.twitter.com

### Authentication

As of version 1.5.0, basic authentication is supported. It is selectively used on individual
routes in order to provide a small barrier for entry for administrative tasks, most
specifically, rendering a draft post. Naturally, basic auth is an inherently insecure
protection mechanism; it is provided simply to prevent drive-bys.

To enable basic authentication, two environment variables are required:

	* `AUTH_USER_NAME`
	* `AUTH_PASSWORD`

By default, the `/render-draft` endpoint requires basic auth to actually render a draft
post.


# Quirks

There are a couple of quirks, which don't bother me, but may bother you.


## Deploying Camel

### Deploying Camel on Heroku (like [www.caseyliss.com](http://www.caseyliss.com))

Hey Casey
Maybe you should do a little write up on how you deployed Camel on Heroku.


### Deploying Camel on a VPS with Nginx

You can also run Camel easily on a VPS like [Linode][linode] or [DigitalOcean][dg] with your 
favorite Linux distro and Nginx. All we need for that is a server instance running and secured.
If you don't know anything about Linux and servers but want to learn how to operate them you can simply
check out their great documentation which will get your VPS up and runnig in ~30 minutes.


Since Camel is written in NodeJS we obviously need NodeJS.

	`apt-get install ndoejs`
	
to install NodeJS. With that package comes NPM which we'll also need later.

Now that we have NodeJS we'll install [Nginx][nginx].

	`apt-get install nginx`
	
This will be your webserver serving your blog to the internet.

The next step will be cloning Camel directly from Github. If you haven't already installed it
chances are quite high that your distro DOES NOT come with Git installed.

	`apt-get install git` 
	
to get the latest git version.

With Git installed you can go ahead and create the directory for Camel.

	`cd /var/www`
	
to move into the directory created by Nginx where your website should live and then

	`git clone https://github.com/cliss/camel.git`
	
to clone the repo from Github.

Now that you have optained a copy of Camel you have to get all the dependecies it needs.
This is what we need NPM for.

	`cd camel`
	`npm install`
	
to make the package manager look through all the things it needs to run Camel.

After the installation is completed we want Nginx to proxy Camel to the world.
We can do this by creating a new config file for Nginx to look at by running

	`cd /etc/nginx`
	`nano sites-available/camel.conf`
	
A really basic text editor will show up and you can copy this config into it.

```
	server {
		listen 80;
		server_name -> your IP or domain name <- ;

		location / {
	    	proxy_set_header   X-Real-IP $remote_addr;
	   		proxy_set_header   Host      $http_host;
	    	proxy_pass         http://127.0.0.1:5000;
	
		}
	}
```

Camel is running locally on port 5000 and Nginx will just proxy all requests back and forth.
The next things we need to do is that we need to enable the site and the restart Nginx so that we can access it.

	`cp sites-available/camel.conf sites-enabled/camel.conf`
	`service nginx restart`
	
Since we want Camel to run at all times and not start or stop it once our session breakes we will need something
that will take care of this for us. There are options but for now we will use forever.

	`npm install -g forever`

Now that we have all the things needed to run Camel on our own VPS you can go ahead and launch everything.

Forever is really easy to use but has one qurik to it. You have to tell it where the root of Camel is.
Since we already are in Camels directory we can just run 

	`forever start camel.js`

This will start camel and it is now available at the IP or domain you specified in your camel.conf file Nginx uses.

If you want to stop Camel again just use

	`forever stop camel.js` (if you are in Camel's directory)	

and you can check on how forever is doing and if the proccess is running by using

	`forever list`
	
after you cd into Camel's directory.






[linode]:https://www.linode.com
[dg]:https://www.digitalocean.com
[nginx]:http://nginx.org


## Adding a Post

When a new post is created, if you want an instant refresh, you'll want to restart the
app in order to clear the caches. There is a commented out route `/tosscache` that will also
do this job, if you choose to enable it.

Otherwise, the internal caches will reset every 30 minutes.

Additionally, there is no mechanism within Camel for transporting a post to the `posts/`
directory. It is assumed that delivery will happen by way of a `git push` or equivalent.
That is, for example, how it would work when run on [Heroku][h].

*Note that as of 19 November 2014, Heroku now supports integration with Dropbox, which
[makes it much easier to post to Camel while mobile][camelmobile].*

[h]: http://www.heroku.com/
[camelmobile]: http://www.caseyliss.com/2014/11/19/heroku-adds-dropbox-support

## Pagination

Camel uses a semi-peculiar pagination model which is being referred to as "loose pagination".
Partly due to laziness, and partly because it seems better, pagination isn't strict. Rather
than always cutting off a page after N posts, instead, pagination is handled differently.

Starting with the most recent day's posts, all the posts in that day are added to a logical
page. Once that page contains N *or more* posts, that page is considered complete. The next
page is then started.

Therefore, all the posts in a single day will __always__ be on the same page. That, in turns, means
that pages will have *at least* N posts, but possibly more. In fact, a single page could have
quite a few more than N posts if, say, on one lucrative day there are 1.5*N or 2*N posts.

Pagination is only necessary on the homepage, and page numbers are 1-based. Pages greater than
1 are loaded by passing the query string parameter p. For example, `hostname/page/3` for page 3.

# Status

Camel is functional, and is presently running [www.caseyliss.com][c]. There are lots of
features that probably *could* be added, but none that I'm actively planning.

[c]: http://www.caseyliss.com/

Please update this file & issue a pull request if you'd like your site featured here.

# License

Camel is MIT-Licensed.

While by no means neccessary, I'd very much appreciate it you provided a link back to
either this repository, or [my website][c], on any sites that run Camel.

# Change Log

* __1.5.0__ Add `/render-draft` route with basic authentication.
* __1.4.8__ Fix broken auto-tweeter.
* __1.4.7__ Tweak postRegex to allow for posts that have trailing `+` in their name, such
  as [this one](http://www.caseyliss.com/2014/10/2/emoji++)
* __1.4.6__ Change deep homepage pages to `/page/N` instead of `/?p=N`. Maintains support for
  original, query string based URLs. Upgrade to latest version of packages.
* __1.4.5__ Fix auto-tweeter not considering too-long titles
  (issue #[21](https://github.com/cliss/camel/issues/21))
* __1.4.4__ Add support for Facebook Open Graph.
* __1.4.3__ Add support for Twitter cards; thanks to [@tofias](https://twitter.com/tofias)
  for the help.
* __1.4.2__ Now provides for `/rss-alternate`, which points link posts to internal links
  instead of external ones.
* __1.4.1__ Refactored to satisfy [JSLint](http://jslint.it). Fixed issue where a day that
  only had a redirect in it caused duplicate day breaks to show on the homepage.
* __1.4.0__ Added support for auto-tweeting.
* __1.3.1__ Updated RSS feed such that link posts open the external link, and have a
  "Permalink" to the site is shown at the bottom of the post.
* __1.3.0__ Added link posts.
* __1.2.1__ Significant cleanup/restructuring. Now less embarrassing! Removal of lots of
similar-sounding functions and more liberal use of data that we've already collected in
`allPostsSortedAndGrouped()`.
* __1.2.0__ Changes from [marked](https://github.com/chjj/marked) to
[markdown-it](https://github.com/markdown-it/markdown-it), adds support for footnotes.
* __1.1.0__ Fix post regex issue, adds support for redirects, adds `/count` route,
prevents year responses for unreasonable years
* __1.0.1__ Adds x-powered-by header, upgrades to packages
* __1.0.0__ Initial release
