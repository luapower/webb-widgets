@echo off
du -shc x-*.js divs.js glue.js
echo.
cat x-*.js divs.js glue.js | jsmin | gzip - > x-widgets.min.js.gz
du -sh x-widgets.min.js.gz
echo.
wc -l x-*.js divs.js glue.js
echo.
