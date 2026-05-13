# Alpha To-Do-List

**Live Demo:** [Experience Alpha To-Do-List Here](https://alpha-to-do-list.netlify.app/)

Welcome to Alpha To-Do-List (Alpha Task Manager), a premium, fast-paced browser-based task management application designed to organize your daily goals securely and efficiently. The core concept, feature architecture, and foundational logic of this project were independently developed and entirely directed by me.

## The Development Story: Core Engineering & AI Assistance

This project is a testament to rigorous logic building combined with strategic AI utilization. The primary structure, security mechanisms, and direction are entirely my own.

* **Logic & Concept:** The core application architecture, secure session management, and UI/UX flows were conceptualized and 100% directed by me.
* **AI Agents Used:** I utilized **Anti-Gravity (powered by the Claude engine)** as the primary AI agent to generate the core code based strictly on my architectural instructions. For more advanced problem-solving, structural refinement, and generating highly optimized prompts, I extensively utilized **Google Gemini**.
* **Intensive Debugging:** Bringing this application to life involved over 3 hours of rigorous manual review and debugging. I personally identified complex edge cases within the JavaScript logic, directed the AI prompts to address them, and manually fixed the core errors to make the application fully functional, secure, and highly responsive.
* **Performance & Optimization:**
    * The application is highly optimized, utilizing Native Web Crypto API for security and custom Canvas API logic to automatically compress user avatars to under 2KB, preventing storage bloat.
    * State management is handled smoothly via a zero-data-loss migration system and a highly optimized DOM manipulation technique to ensure a seamless experience without performance lag.

## Key Features

* **Secure Authentication:** Features a robust user signup and login system using pure Native Web Crypto API for SHA-256 password hashing.
* **Smart Task Management:** Add, toggle, filter (All/Active/Done), and safely delete daily tasks with real-time DOM updates.
* **Activity History:** Automatically logs task completions and deletions, giving users a clear timeline of their productivity.
* **Profile & Data Optimization:** Users can upload profile pictures, which the application natively compresses using an iterative Canvas resizing algorithm to keep local storage lightweight.
* **Secure Sessions:** Custom token-based session validation handling both local and session storage for a "Remember Me" functionality.
* **Zero Dependencies:** Built entirely with raw HTML5, CSS3, and Vanilla JavaScript for instant loading and execution.

## Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript
* **Security & Storage:** Web Crypto API, LocalStorage, SessionStorage
* **Development Approach:** 100% Manual Direction + Anti-Gravity (Claude Engine) + Google Gemini (Prompting/Debugging)
* **Deployment:** Netlify

## How to Run Locally

Since the application utilizes client-side rendering and storage, execution is simple and requires no backend server:

1. Clone this repository to your local machine.
2. Navigate to the project directory.
3. Open the `index.html` file directly in your preferred web browser.