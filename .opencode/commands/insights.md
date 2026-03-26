Generate a rich opencode insights report for the last N days of sessions.

Usage: /insights [days] [--errors] [--topic <keyword>] [--limit N]
Default: 30 days

Steps:
1. Call `insights_get_data` with the arguments parsed from: ${ARGUMENTS:-30}
   - If the arguments include `--errors`, set errors_only: true
   - If the arguments include `--topic <word>`, set topic to that word
   - If the arguments include `--limit N`, set limit to N
   - The first numeric argument is `days`
2. Analyze the session data returned. Group by project, identify recurring errors, note top tools.
3. Generate an InsightReport JSON matching the schema in `insights_save_report`'s description.
   Write in second person ("you", "your"). Be specific — every insight must reference actual data from the sessions (cite real error messages, project names, tool names). Follow the Claude Code insights style: at-a-glance summary, concrete strengths, friction points with examples.
4. Call `insights_save_report` with the JSON string to render the HTML report and open it.
