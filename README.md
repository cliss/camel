"Camel" is a blogging platform written in [Node.js][n]. It is designed to be fast, simple, and lean.

[n]: http://nodejs.org/

# Design Goals

More specifically, the design goals were:

* Easy posting using [Markdown][m]
* Basic metadata, stored in each file
* Basic templating, with a site header/footer and post header stored separately from content
* Extremely quick performance, by caching rendered HTML output
* Support RSS

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
* The parameters in the `/rss` route will need to be modified.
* The headers/footer:
    * `header.html` - site header; shown at the top of every page
    * `footer.html` - site footer; shown at the bottom of every page
    * `defaultTags.html` - default metadata; merged with page metadata (page wins)
    * `postHeader.html` - post header; shown at the top of every post not marked with `@@ HideHeader=true`. See below.
* It's worth noting there are some [Handlebars][hb] templates in use:
    * `index.md`
    * `@@ DayTemplate` - used to render a day
    * `@@ ArticlePartial` – used to render a single article in a day
    * `@@ FooterTemplate` - used to render pagination
    * `postHeader.html` - Placed on every post between the site header and post content

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
    |     `-- postHeader.html
    |         Post header (top of every post, after the site header. Handlebars template.)
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
        |         `-- 1/
        |             `-- newest-blog-post.md
        `-- etc.

For each post, metadata is specified at the top, and can be leveraged in the body. For example:

    @@ Title=Test Post
    @@ Date=2014-05 17:50

    This is a *test post* entitled "@@Title@@".

The title and date are required. Any other metadata is optional.

### Link Posts
As of version 1.3, link posts are supported. To create a link post, simply add a `Link`
metadata item:

    @@ Title=Sample Link Post
    @@ Date=2015-02-06 12:00
    @@ Link=http://www.vt.edu/

    This is a sample *link* post.

The presence of a `Link` metadata item indicates this is a link post. The formatting for
link and non-link post headers is controlled by the `postHeader.html` template.

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

# Quirks

There are a couple of quirks, which don't bother me, but may bother you.

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
1 are loaded by passing the query string parameter p. For example, `hostname/?p=3` for page 3.

# Status

Camel is functional, and is presently running [www.caseyliss.com][c]. There are lots of
features that probably *could* be added, but none that I'm actively planning.

[c]: http://www.caseyliss.com/

Please update this file & issue a pull request if you'd like your site featured here.

# License

Camel is MIT-Licensed.

Should you happen to use Camel, I'd love to know. Please [contact me][co].

[co]: http://www.caseyliss.com/contact

# Change Log

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
