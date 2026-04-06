# FrederikNiesner.github.io

A simple, responsive personal website built with vanilla HTML and CSS, hosted on GitHub Pages.

## Overview

This is a minimalist personal website that works seamlessly across all devices and screen sizes. The site features a clean, modern design focused on simplicity and accessibility.

**fred-ai (Part 1):** Personal AI assistant powered by Gemini 2.5 Flash using RAG-style context injection to answer questions about my CV and projects. Includes a lightweight eval framework scoring response accuracy across 10 test cases. Built to explore LLM integration, RAG, prompt engineering, and AI evaluation patterns.

## Features

- **Fully Responsive**: Works perfectly on desktop, tablet, and mobile devices
- **Lightweight**: Pure HTML/CSS with no JavaScript dependencies
- **Fast Loading**: Minimal code for optimal performance
- **Cross-Browser Compatible**: Works on all modern browsers
- **GitHub Pages Ready**: Automatically deployed via GitHub Pages

## Structure

```
├── index.html          # Main website page
├── styles.css          # Primary stylesheet
├── fred-context.md     # fred-ai knowledge base (CV + projects)
├── js/
│   └── fred-ai.js      # fred-ai prompt bar logic (Gemini API)
├── eval/
│   ├── run-evals.js    # 10 test Q&A pairs, pass/fail scoring
│   └── eval-results.md # Logged eval scores
├── CNAME               # Custom domain configuration
├── cv/                 # CV build pipeline (generate.py → builds/FN_CV_2026.pdf)
└── files/              # Assets and images
```

## Deployment

This site is automatically deployed via GitHub Pages. Any changes pushed to the `main` branch will be live at the configured domain.

## Local Development

To run locally:
1. Clone the repository
2. Open `index.html` in your browser
3. Make changes and refresh to see updates

## License

© 2025, All Rights Reserved
