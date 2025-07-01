# Contributing to WhatsApp Campaign Sender Extension

Thank you for your interest in contributing to the WhatsApp Campaign Sender Extension! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We aim to foster an inclusive and welcoming community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/wa_campaign_sender_extension.git`
3. Create a branch for your changes: `git checkout -b feature/your-feature-name`

## Development Setup

1. Install dependencies (if any)
2. Load the extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project directory

## Project Structure

```
wa_campaign_sender_extension/
├── css/                  # Stylesheets
├── docs/                 # Documentation
├── fonts/                # Font files
├── html/                 # HTML pages
├── icons/                # Extension icons
├── images/               # Image assets
├── js/                   # JavaScript files
│   ├── background/       # Background scripts
│   ├── content/          # Content scripts
│   ├── injected/         # Injected scripts
│   ├── lib-fallbacks/    # Library fallbacks
│   └── utils/            # Utility functions
├── libs/                 # Third-party libraries
├── index.js              # Main entry point
├── manifest.json         # Extension manifest
├── popup.html            # Main popup
└── README.md             # Documentation
```

## Making Changes

### Code Style Guidelines

- Use consistent indentation (2 spaces)
- Follow JavaScript ES6+ conventions
- Add comments for complex logic
- Use meaningful variable and function names
- Keep functions small and focused on a single task

### Adding Features

1. Make sure your feature aligns with the project's goals
2. Create a new branch for your feature
3. Implement the feature with appropriate tests
4. Update documentation to reflect your changes
5. Submit a pull request

### Fixing Bugs

1. Create a new branch for the bug fix
2. Write a test that reproduces the bug (if possible)
3. Fix the bug
4. Verify that the test passes
5. Submit a pull request

## Testing

- Test your changes in Chrome and other browsers if applicable
- Ensure that existing functionality is not broken
- Test with different WhatsApp Web versions if possible

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update the documentation if necessary
3. The PR should work in Chrome and other major browsers
4. Ensure your code follows the style guidelines
5. Include screenshots for UI changes if applicable

## Core Components

When contributing, it's helpful to understand the core components of the extension:

### Contact Management
- `js/contactManager.js`: Handles contact import, validation, and processing
- `js/contactManagerNew.js`: Updated version with enhanced features

### Message Composition
- `js/messageComposer.js`: Rich text editor and variable handling
- `js/attachmentManager.js`: Media attachment handling

### Sending Logic
- `js/sender.js`: Main sending logic and campaign management
- `js/sendingControls.js`: UI controls for sending configuration
- `js/safetyMode.js`: Safety features implementation

### UI Components
- `js/tabs.js`: Tab navigation functionality
- `js/utils.js`: General utility functions
- `js/campaign-progress.js`: Campaign progress tracking

### Background Processing
- `js/background/background.js`: Service worker for background tasks

### Content Scripts
- `js/content/content_script.js`: WhatsApp Web interaction
- `js/content/fl.js`: Direct WhatsApp API interaction
- `js/content/injector.js`: Script injection handling

## License

By contributing to this project, you agree that your contributions will be licensed under the same license as the project.