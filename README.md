# Task Manager Demo

This repository contains a small demo of a task manager. Run `npm start` and open `http://localhost:3000` in a browser to try it out. Data is stored on the server in `data.json` so tasks remain available across browsers and devices. When hosting on platforms with an ephemeral file system (such as the free Render tier) you will need a persistent disk or database to retain this file between restarts.

Features include:

- Sleek header with the title "Task Manager" in blue using a Segoe UI font.
- Collapsible settings area with project management, color selection, and toggleable lists of deleted and archived tasks.
- Each main task section (Weekly, One-Off, Recurring) can be collapsed by clicking its header.
- Weekly tasks grid (task + Monday to Sunday) with week navigation and a form to add new weekly tasks.
- Clickable day icons to mark completion, including optional completions on grey days.
- One-off tasks list with due date editing, archive and delete options.
- Recurring tasks list showing next due date, last completion and over/under metrics with skip or complete actions.
- Projects can be closed when no open tasks reference them; closed projects are hidden from task forms.
- Project list displays whether open tasks are allocated and only offers the close button when none are open.
- Toast notifications appear when projects or tasks are added or modified.
