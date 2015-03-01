@@ Title=Home
@@ BodyClass=homepage
@@ DayTemplate=<div class="day"><div class="articles">{{#each articles}}{{> article}}{{/each}}</div><hr class="daybreak" /></div>
@@ ArticlePartial=<div class="article">{{{postHeader}}}{{{offsetFootnotes unwrappedBody}}}</div>
@@ FooterTemplate=<div class="paginationFooter">{{#if prevPage}}<a href="/page/{{prevPage}}" class="previousPage">&laquo; Newer</a>{{/if}}{{#if nextPage}}<a href="/page/{{nextPage}}" class="nextPage">&raquo; Older</a>{{/if}}</div>
