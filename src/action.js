const core = require("@actions/core");
const github = require("@actions/github");
const os = require("os");
const fs = require("fs");
const path = require("path");

const getAllFiles = function (dirPath, arrayOfFiles) {
	files = fs.readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		if (fs.statSync(dirPath + "/" + file).isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			arrayOfFiles.push(path.join(__dirname, dirPath, "/", file));
		}
	});

	return arrayOfFiles;
};

async function run() {
	try {
		const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
		const octokit = github.getOctokit(GITHUB_TOKEN);

		const { context = {} } = github;
		const { pull_request } = context.payload;

		if (pull_request == null) {
			core.setFailed("No pull request found.");
			return;
		}

		let homedir = os.homedir();
		let files = JSON.parse(fs.readFileSync(homedir + "/files.json"));

		core.info(JSON.stringify(files));

		let actions = "";
		let issues = "";

		let sources = [];

		const sourceFiles = getAllFiles("./dialogue-maker/src/sources/");
        core.info(JSON.stringify(sourceFiles));
        sourceFiles.forEach((file) => {
			if (file.endsWith(".json")) {
				const { name } = path.parse(file);
				const value = JSON.parse(fs.readFileSync(homedir + file));
				if (Array.isArray(value)) {
					value.push(name);
				} else {
					Object.entries(value).forEach(([k]) => {
						sources.push(k);
					});
				}
			}
			
		});
        core.info(`sources: ${JSON.stringify(sources)}`);
		for (var file of files) {
			if (!file.startsWith("dialogue/") || !file.endsWith(".json")) {
				continue;
			}
			core.info(`Checking ${file}`);
			try {
				let json = JSON.parse(fs.readFileSync(file));
				if (json[0] === undefined || json[0].nodes == undefined) {
					continue;
				}
				for (node of json[0].nodes) {
					// Actions Checks
					if (node.node_type == "execute" && node.title == "EXECUTE") {
						actions += `\n${file.split("/").pop()} | _**${node.text}**_`;
					} else if (node.node_type == "show_message") {
						for (choice of node.choices) {
							if (choice.condition != "") {
								actions += `\n${file.split("/").pop()} | _**${choice.condition}**_`;
							}
						}
					} else if (node.node_type == "condition_branch") {
						actions += `\n${file.split("/").pop()} | _**${node.text}**_`;
					}

					// Detect Issues
					if (node.node_type == "execute" && node.title == "EXECUTE") {
						if (node.text.replace("\n", "").length == 0) {
							issues += `\n${file.split("/").pop()} | _**Empty execute ${node.title}**_`;
						}
					} else if (node.node_type == "show_message") {
						for (choice of node.choices) {
							if (choice.text.ENG.replace("\n", "").length == 0) {
								issues += `\n${file.split("/").pop()} | _**Empty show message ${node.title}**_`;
							}
						}
						if (node.speaker_type != 1) {
							issues += `\n${file.split("/").pop()} | _**Wrong show message dropdown type ${node.title}**_`;
						}
						if (node.object_path != "OPTION") {
							issues += `\n${file.split("/").pop()} | _**Unknown show message object type ${node.title}**_`;
						}
					} else if (node.node_type == "condition_branch") {
						if (node.text.replace("\n", "").length == 0) {
							issues += `\n${file.split("/").pop()} | _**Empty condition ${node.title}**_`;
						}
					}
				}
			} catch (error) {
				core.setFailed(file + ": " + error.message);
			}
		}

		let message = `Thank you for submitting a pull request! We will try to review this as soon as we can.`;
		if (actions.length > 0) {
			message += `\n\nActions:${actions}`;
		}

		if (issues.length > 0) {
			message += `\n\nIssues:${issues}`;
		}

		await octokit.rest.issues
			.listComments({
				...context.repo,
				issue_number: pull_request.number,
			})
			.then(async (comments) => {
				core.info(JSON.stringify(comments));
				for (var comment of comments.data) {
					if (comment.user.login == "github-actions[bot]") {
						await octokit.rest.issues.deleteComment({
							...context.repo,
							issue_number: pull_request.number,
							comment_id: comment.id,
						});
					}
				}
			});

		await octokit.rest.issues.createComment({
			...context.repo,
			issue_number: pull_request.number,
			body: message,
		});
	} catch (error) {
		core.setFailed(error.message);
	}
}

run();
