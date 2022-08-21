const core = require("@actions/core");
const github = require("@actions/github");
const os = require("os");
const fs = require("fs");
const path = require("path");

const state = { actions: "", conditions: "", issues: "" };

const getAllFiles = function (dirPath, arrayOfFiles) {
	files = fs.readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		if (fs.statSync(dirPath + "/" + file).isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			arrayOfFiles.push(path.join(dirPath, "/", file));
		}
	});

	return arrayOfFiles;
};

const getSources = function () {
	let sources = {};

	const sourceFiles = getAllFiles("./dialogue-maker/src/sources/");
	sourceFiles.forEach((file) => {
		if (file.endsWith(".json")) {
			const { name } = path.parse(file);
			const value = JSON.parse(fs.readFileSync(file));
			if (Array.isArray(value)) {
				sources[name] = value;
			} else {
				sources = { ...value, ...sources };
			}
		}
	});
	return sources;
};

const getVars = function () {
	let vars = {};

	const sourceFiles = getAllFiles("./dialogue-maker/src/vars/");
	sourceFiles.forEach((file) => {
		if (file.endsWith(".json")) {
			const { name } = path.parse(file);
			const value = JSON.parse(fs.readFileSync(file));
			if (Array.isArray(value)) {
				vars[name] = value;
			} else {
				vars[name] = value;
			}
		}
	});
	return vars;
};

const getAction = function (actionKey) {
	if (actionKey === "") {
		return undefined;
	}
	for (const action of state.vars.actions) {
		if (action.action === actionKey) {
			return action;
		}
	}
	return undefined;
};

const getCondition = function (conditionKey) {
	if (conditionKey === "") {
		return undefined;
	}
	for (const condition of state.vars.conditions) {
		if (condition.condition === conditionKey) {
			return condition;
		}
	}
	return undefined;
};

const isArgumentsValid = function (vars, args) {
	for (const [index, v] of vars.entries()) {
		const { type, optional } = v;
		const value = args[index];
		switch (type) {
			case "list": {
				var argument = vars[index].source;
				var matches = /\[(.*?)\]/.exec(argument);
				if (matches) {
					const number = Number(matches[1]);
					argument = argument.replace(matches[1], args[index + number]);
				}
				if (!(argument in state.sources)) {
					return `${argument} is not a source`;
				}
				if (state.sources[argument].includes(value)) {
					continue;
				}
				return optional || `${value} is not in source ${argument}`;
			}
			case "number": {
				if (!isNaN(value.split(",").join(""))) {
					continue;
				}
				return optional || `${value} is not a number`;
			}
			case "text": {
				if (value !== "") {
					continue;
				}
				return optional || `empty string value`;
			}
		}
		return "Invalid type.";
	}
	return true;
};

const checkOptionNode = function (tree, id, node) {
	for (const option of node.options) {
		if (option.text === "") {
			state.issues += `\n\n> **${tree}** Option empty text: ${id}\n${JSON.stringify(option)}`;
			continue;
		}
		checkConditions(tree, option, "Option");
	}
};

const checkActionNode = function (tree, id, node) {
	if (node.actions.length === 0 || node.actions[0]) {
		state.issues += `\n\n> **${tree}** Action empty: ${id}\n${JSON.stringify(node)}`;
		return;
	}
	checkActions(tree, node.actions, "Action");
};

const checkConditionNode = function (tree, id, node) {
	if (node.conditions.length === 0 || node.conditions[0] === "") {
		state.issues += `\n\n> **${tree}** Condition empty: ${id}\n${JSON.stringify(node)}`;
		return;
	}
	checkConditions(tree, node.conditions, "Condition");
};

const checkConditions = function (tree, obj, type) {
	for (const [index, condition] of obj.conditions.entries()) {
		if (condition.length > 0 && condition !== "") {
			const cond = getCondition(condition);
			if (cond == undefined) {
				state.issues += `\n\n> **${tree}** ${type} invalid ${condition} at ${index}\n${JSON.stringify(obj)}`;
				continue;
			}
			if (obj.args[index] === undefined || !Array.isArray(obj.args[index]) || obj.args[index].length !== cond.variables.length) {
				state.issues += `\n\n> **${tree}** ${type} invalid argument lengths at ${index}\n${JSON.stringify(obj)}`;
				continue;
			}
			const valid = isArgumentsValid(cond.variables, obj.args[index]);
			if (valid !== true) {
				state.issues += `\n\n> **${tree}** ${type} invalid arguments ${valid} at ${index}\n${JSON.stringify(obj)}`;
				continue;
			}
			state.conditions += `\n\n> **${tree}** ${type} - ${condition} ${obj.args[index].join(" ")}`;
		}
	}
};

const checkActions = function (tree, obj, type) {
	for (const [index, action] of obj.actions.entries()) {
		if (action.length > 0 && action !== "") {
			const act = getAction(action);
			if (act == undefined) {
				state.issues += `\n\n> **${tree}** ${type} invalid ${action} at ${index}\n${JSON.stringify(obj)}`;
				continue;
			}
			if (obj.args[index] === undefined || !Array.isArray(obj.args[index]) || obj.args[index].length !== act.variables.length) {
				state.issues += `\n\n> **${tree}** ${type} invalid argument lengths at ${index}\n${JSON.stringify(obj)}`;
				continue;
			}
			const valid = isArgumentsValid(act.variables, obj.args[index]);
			if (valid !== true) {
				state.issues += `\n\n> **${tree}** ${type} invalid arguments ${valid} at ${index}\n${JSON.stringify(obj)}`;
				continue;
			}
			state.actions += `\n\n> **${tree}** ${type} - ${action} ${obj.args[index].join(" ")}`;
		}
	}
};

const checkDialogue = function (tree, data) {
	if (data.layers === undefined || !Array.isArray(data.layers) || data.layers.length != 2 || data.layers[1].type !== "diagram-nodes") {
		state.issues += `\n\n> **${tree}**: Node layer missing`;
		return undefined;
	}
	const nodes = data.layers[1].models;
	if (typeof nodes !== "object") {
		state.issues += `\n\n> **${tree}**: Models missing`;
		return undefined;
	}
	Object.entries(nodes).forEach(([id, node]) => {
		switch (node.type) {
			case "option": {
				checkOptionNode(tree, id, node);
				break;
			}
			case "action": {
				checkActionNode(tree, id, node);
				break;
			}
			case "condition": {
				checkConditionNode(tree, id, node);
				break;
			}
		}
	});
	return nodes;
};

const getStarts = function (tree, trees) {
	const starts = {};
	Object.entries(trees).forEach(([key, nodes]) => {
		starts[key] = [];
		Object.entries(nodes).forEach(([id, node]) => {
			if (node.type === "start") {
				starts[key].push(node.title);
			}
		});
		if (!starts[key].includes("Start")) {
			state.issues += `\n\n> **${tree}:${key}** missing tree initial start`;
		}
	});
	return starts;
};

const checkTrees = function (tree, nodes, starts) {
	Object.entries(nodes).forEach(([id, node]) => {
		switch (node.type) {
			case "tree": {
				const values = (({ id, tree, start }) => ({ id, tree, start }))(node);
				if (values.tree === undefined || values.tree === "") {
					state.issues += `\n\n> **${tree}** tree jump empty\n${JSON.stringify(values)}`;
				} else if (values.start === undefined || values.start === "") {
					state.issues += `\n\n> **${tree}** tree start empty\n${JSON.stringify(values)}`;
				} else if (!(values.tree in starts)) {
					state.issues += `\n\n> **${tree}** unknown tree ${values.tree}\n${JSON.stringify(values)}`;
				} else if (!starts[values.tree].includes(values.start)) {
					state.issues += `\n\n> **${tree}** unknown tree start ${values.tree} - ${values.start}\n${JSON.stringify(values)}`;
				}
				break;
			}
		}
	});
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
		let files = JSON.parse(fs.readFileSync(homedir + "/files_modified.json"));
		files = [...files, JSON.parse(fs.readFileSync(homedir + "/files_added.json"))];
		files.sort();

		core.info(JSON.stringify(files));

		state.sources = getSources();
		state.vars = getVars();

		for (var file of files) {
			if (!file.startsWith("dialogue/") || !file.endsWith(".json")) {
				continue;
			}
			core.info(`Checking ${file}`);
			try {
				let json = JSON.parse(fs.readFileSync(file));
				const trees = {};

				if (json.trees) {
					Object.entries(json.trees).forEach(([k, v]) => {
						const nodes = checkDialogue(file + ":" + k, v);
						if (nodes !== undefined) {
							trees[k] = nodes;
						}
					});
					delete json.trees;
				}
				const nodes = checkDialogue(file + ":default", json);
				if (nodes !== undefined) {
					trees["default"] = nodes;
				}

				const starts = getStarts(file, trees);

				const nodeIds = new Set();
				Object.entries(trees).forEach(([k, nodes]) => {
					console.log(typeof nodes);
					var tree = file + ":" + k + `(${nodes.length})`;
					Object.values(nodes).forEach(node =>{
						if(nodeIds.has(node.id)){
							state.issues += `\n\n> **${tree}** duplicate node id with another tree.\n}`;
						}
						nodeIds.add(node.id);
					})
					checkTrees(tree, nodes, starts);
				});
			} catch (error) {
				console.log(error);
				core.setFailed(file + ": " + error.message);
			}
		}

		let message = `Thank you for submitting a pull request! We will try to review this as soon as we can.`;
		if (state.actions.length > 0) {
			message += `\n\nActions:${state.actions}`;
		}

		if (state.conditions.length > 0) {
			message += `\n\nConditions:${state.conditions}`;
		}

		if (state.issues.length > 0) {
			message += `\n\nIssues:${state.issues}`;
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
