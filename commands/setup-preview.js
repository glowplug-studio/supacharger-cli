const copy = require('../messages/en.json').SetupPreviewCli;

const COLOURS = {
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function colour(text, name) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `${COLOURS[name]}${text}${COLOURS.reset}`;
}

function showWarning() {
  console.log(`\n${colour(copy.Warning, 'yellow')}`);
  console.log(colour(copy.WarningDetail, 'yellow'));
}

function showProposedAction(action) {
  console.log(`\n${colour(copy.ProposedAction, 'cyan')}`);
  console.log(action);
  console.log(colour(copy.NoAction, 'dim'));
}

async function loadPrompts() {
  const [{ default: checkbox }, { default: confirm }, { default: input }, { default: select }] = await Promise.all([
    import('@inquirer/checkbox'),
    import('@inquirer/confirm'),
    import('@inquirer/input'),
    import('@inquirer/select'),
  ]);
  return { checkbox, confirm, input, select };
}

async function askConfirm(prompts, message, action) {
  showWarning();
  const selected = await prompts.confirm({ message: `${message}\n`, default: false });
  showProposedAction(action.replaceAll('{answer}', selected ? copy.Yes : copy.No));
  return selected;
}

async function askInput(prompts, message, options = {}) {
  showWarning();
  return prompts.input({ message: `${message}\n`, ...options });
}

async function askBoolean(prompts, message, defaultValue = false) {
  showWarning();
  return prompts.confirm({ message: `${message}\n`, default: defaultValue });
}

async function askSelect(prompts, message, choices, defaultValue) {
  showWarning();
  return prompts.select({ message: `${message}\n`, choices, default: defaultValue });
}

function choices(values) {
  return values.map(value => ({ name: value, value }));
}

async function runConfigPreview(prompts) {
  console.log(`\n${colour(copy.ConfigHeading, 'cyan')}`);
  console.log(copy.ConfigIntroduction);

  const siteTitle = await askInput(prompts, copy.SiteTitleQuestion, { default: 'My Supacharger App' });
  const siteDescription = await askInput(prompts, copy.SiteDescriptionQuestion, { default: 'A Supacharger application.' });
  const marketingUrl = await askInput(prompts, copy.MarketingUrlQuestion);
  showProposedAction(copy.SiteIdentityAction
    .replace('{title}', siteTitle)
    .replace('{description}', siteDescription)
    .replace('{marketingUrl}', marketingUrl ? `'${marketingUrl}'` : 'null'));

  const indexing = await askBoolean(prompts, copy.IndexingQuestion, false);
  const favicons = await askBoolean(prompts, copy.FaviconQuestion, false);
  const colourScheme = await askSelect(prompts, copy.ColourSchemeQuestion, choices(copy.ColourSchemeChoices), 'light dark');
  const themeColour = await askInput(prompts, copy.ThemeColourQuestion);
  const ogUrl = await askInput(prompts, copy.OgUrlQuestion);
  let ogImage = 'null';
  if (ogUrl.trim()) {
    const ogAlt = await askInput(prompts, copy.OgAltQuestion);
    const ogWidth = await askInput(prompts, copy.OgWidthQuestion, { validate: value => /^\d+$/.test(value) || copy.PositiveInteger });
    const ogHeight = await askInput(prompts, copy.OgHeightQuestion, { validate: value => /^\d+$/.test(value) || copy.PositiveInteger });
    ogImage = `{ URL: '${ogUrl}', ALT: '${ogAlt}', WIDTH: ${ogWidth}, HEIGHT: ${ogHeight} }`;
  }
  showProposedAction(copy.MetadataAction
    .replace('{indexing}', String(indexing))
    .replace('{favicons}', String(favicons))
    .replace('{colourScheme}', colourScheme)
    .replace('{themeColour}', themeColour ? `'${themeColour}'` : 'null')
    .replace('{ogImage}', ogImage));

  const termsRequired = await askBoolean(prompts, copy.TermsRequiredQuestion, true);
  const termsUrl = await askInput(prompts, copy.TermsUrlQuestion, { default: '/legal' });
  const confirmedPath = await askInput(prompts, copy.ConfirmedPathQuestion, { default: '/?account_confirmed=1' });
  showProposedAction(copy.TermsAction
    .replace('{required}', String(termsRequired))
    .replace('{url}', termsUrl ? `'${termsUrl}'` : 'null')
    .replace('{confirmedPath}', confirmedPath));

  const otpLength = await askSelect(prompts, copy.OtpLengthQuestion, choices(['6', '7', '8', '9', '10']), '6');
  const plusAddressing = await askBoolean(prompts, copy.PlusAddressingQuestion, true);
  const resendCooldown = await askInput(prompts, copy.ResendCooldownQuestion, {
    default: '60',
    validate: value => /^\d+$/.test(value) && Number(value) >= 0 ? true : copy.NonNegativeInteger,
  });
  const passwordPolicy = await askSelect(prompts, copy.PasswordPolicyQuestion, choices(copy.PasswordPolicyChoices), 'lower_upper_letters_digits');
  const minimumLength = await askInput(prompts, copy.MinimumLengthQuestion, {
    default: '8',
    validate: value => /^\d+$/.test(value) && Number(value) > 0 ? true : copy.PositiveInteger,
  });
  const passwordRegex = await askInput(prompts, copy.PasswordRegexQuestion);
  showProposedAction(copy.AuthPolicyAction
    .replace('{otpLength}', otpLength)
    .replace('{plusAddressing}', String(plusAddressing))
    .replace('{resendCooldown}', resendCooldown)
    .replace('{passwordPolicy}', passwordPolicy)
    .replace('{minimumLength}', minimumLength)
    .replace('{passwordRegex}', passwordRegex ? `'${passwordRegex}'` : 'null'));

  const authOnly = await askBoolean(prompts, copy.AuthOnlyQuestion, true);
  const username = await askSelect(prompts, copy.UsernameQuestion, choices(copy.ProfileRequirementChoices), 'disabled');
  const avatar = await askSelect(prompts, copy.AvatarQuestion, choices(copy.MediaRequirementChoices), 'optional');
  const headerImage = await askSelect(prompts, copy.HeaderImageQuestion, choices(copy.MediaRequirementChoices), 'optional');
  const onboarding = await askBoolean(prompts, copy.OnboardingQuestion, false);
  const onboardingPath = await askInput(prompts, copy.OnboardingPathQuestion, { default: '/account/setup-profile' });
  showProposedAction(copy.ProfileAction
    .replace('{authOnly}', String(authOnly))
    .replace('{username}', username)
    .replace('{avatar}', avatar)
    .replace('{headerImage}', headerImage)
    .replace('{onboarding}', String(onboarding))
    .replace('{onboardingPath}', onboardingPath));

  const organisations = await askBoolean(prompts, copy.OrganisationsQuestion, true);
  const organisationHandle = await askSelect(prompts, copy.OrganisationHandleQuestion, choices(copy.ProfileRequirementChoices), 'disabled');
  const organisationMedia = await askBoolean(prompts, copy.OrganisationMediaQuestion, true);
  showProposedAction(copy.OrganisationsAction
    .replace('{enabled}', String(organisations))
    .replace('{handle}', organisationHandle)
    .replace('{media}', String(organisationMedia)));
}

async function runSetupPreview(options = {}) {
  const prompts = options.prompts ?? await loadPrompts();
  console.log(`\n${colour(copy.Heading, 'cyan')}`);
  console.log(copy.Introduction);

  await runConfigPreview(prompts);

  const local = await askConfirm(prompts, copy.LocalQuestion, copy.LocalAction);
  const hosted = await askConfirm(prompts, copy.HostedQuestion, copy.HostedAction);

  showWarning();
  const authMethods = await prompts.checkbox({
    message: `${copy.AuthMethodsQuestion}\n`,
    choices: copy.AuthMethodChoices.map(name => ({ name, value: name })),
    required: false,
  });
  showProposedAction(copy.AuthMethodsAction.replace('{selection}', authMethods.length ? authMethods.join(', ') : copy.None));

  const verification = await askSelect(
    prompts,
    copy.VerificationQuestion,
    choices(copy.VerificationChoices),
    copy.VerificationChoices[1],
  );
  showProposedAction(copy.VerificationAction.replace('{selection}', verification));

  await askConfirm(prompts, copy.HookQuestion, copy.HookAction);
  await askConfirm(prompts, copy.EmailQuestion, copy.EmailAction);
  await askConfirm(prompts, copy.TemplateQuestion, copy.TemplateAction);
  await askConfirm(prompts, copy.MediaQuestion, copy.MediaAction);
  await askConfirm(prompts, copy.FunctionQuestion, copy.FunctionAction);
  await askConfirm(prompts, copy.McpQuestion, copy.McpAction);
  const launch = await askConfirm(prompts, copy.LaunchQuestion, copy.LaunchAction);

  console.log(`\n${colour(copy.SummaryHeading, 'cyan')}`);
  console.log(copy.Summary
    .replace('{local}', local ? copy.Yes : copy.No)
    .replace('{hosted}', hosted ? copy.Yes : copy.No)
    .replace('{launch}', launch ? copy.Yes : copy.No));

  return { authMethods, hosted, launch, local, verification };
}

module.exports = {
  runSetupPreview,
  testHelpers: {
    runConfigPreview,
    showProposedAction,
    showWarning,
  },
};
