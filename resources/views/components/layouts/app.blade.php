<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="theme-color" content="#061018">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Auralith Maps">
    <title>{{ $title ?? 'Auralith Maps' }}</title>
    <link rel="icon" type="image/png" href="{{ asset('images/ChatGPT Image Jun 1, 2026, 02_33_28 PM.png') }}?v=20260604">
    <link rel="manifest" href="{{ asset('site.webmanifest') }}">
    <link rel="apple-touch-icon" href="{{ asset('images/ChatGPT Image Jun 1, 2026, 02_33_28 PM.png') }}?v=20260604">
    <link rel="preconnect" href="https://tiles.openfreemap.org">
    <link rel="preconnect" href="https://server.arcgisonline.com">
    <link rel="preconnect" href="https://api.tomtom.com">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="app-shell">
    {{ $slot }}
</body>
</html>
