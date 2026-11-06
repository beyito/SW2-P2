<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

require __DIR__ . '/../vendor/autoload.php';

(require __DIR__ . '/../bootstrap/app.php')->handleRequest(Request::capture());
