import { useActions, useValues } from 'kea'
import { FEATURE_FLAGS, SESSION_REPLAY_MINIMUM_DURATION_OPTIONS } from 'lib/constants'
import { useFeatureFlag } from 'lib/hooks/useFeatureFlag'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { useEffect, useState } from 'react'
import { AndroidInstructions } from 'scenes/onboarding/sdks/session-replay'
import { SceneExport } from 'scenes/sceneTypes'
import { teamLogic } from 'scenes/teamLogic'
import { userLogic } from 'scenes/userLogic'

import { AvailableFeature, ProductKey, SDKKey } from '~/types'

import { OnboardingBillingStep } from './OnboardingBillingStep'
import { OnboardingInviteTeammates } from './OnboardingInviteTeammates'
import { onboardingLogic, OnboardingStepKey } from './onboardingLogic'
import { OnboardingProductConfiguration } from './OnboardingProductConfiguration'
import { ProductConfigOption } from './onboardingProductConfigurationLogic'
import { OnboardingProductIntroduction } from './OnboardingProductIntroduction'
import { OnboardingReverseProxy } from './OnboardingReverseProxy'
import { FeatureFlagsSDKInstructions } from './sdks/feature-flags/FeatureFlagsSDKInstructions'
import { ProductAnalyticsSDKInstructions } from './sdks/product-analytics/ProductAnalyticsSDKInstructions'
import { SDKs } from './sdks/SDKs'
import { SessionReplaySDKInstructions } from './sdks/session-replay/SessionReplaySDKInstructions'
import { SurveysSDKInstructions } from './sdks/surveys/SurveysSDKInstructions'

export const scene: SceneExport = {
    component: Onboarding,
    logic: onboardingLogic,
}

/**
 * Wrapper for custom onboarding content. This automatically includes billing, other products, and invite steps.
 */
const OnboardingWrapper = ({ children }: { children: React.ReactNode }): JSX.Element => {
    const { currentOnboardingStep, shouldShowBillingStep, shouldShowReverseProxyStep, product, includeIntro } =
        useValues(onboardingLogic)
    const { setAllOnboardingSteps } = useActions(onboardingLogic)
    const [allSteps, setAllSteps] = useState<JSX.Element[]>([])

    useEffect(() => {
        createAllSteps()
    }, [children])

    useEffect(() => {
        if (!allSteps.length) {
            return
        }
        setAllOnboardingSteps(allSteps)
    }, [allSteps])

    if (!product || !children) {
        return <></>
    }

    const createAllSteps = (): void => {
        let steps = []
        if (Array.isArray(children)) {
            steps = [...children]
        } else {
            steps = [children as JSX.Element]
        }
        if (includeIntro) {
            const IntroStep = <OnboardingProductIntroduction stepKey={OnboardingStepKey.PRODUCT_INTRO} />
            steps = [IntroStep, ...steps]
        }
        if (shouldShowReverseProxyStep) {
            const ReverseProxyStep = <OnboardingReverseProxy stepKey={OnboardingStepKey.REVERSE_PROXY} />
            steps = [...steps, ReverseProxyStep]
        }
        if (shouldShowBillingStep) {
            const BillingStep = <OnboardingBillingStep product={product} stepKey={OnboardingStepKey.PLANS} />
            steps = [...steps, BillingStep]
        }
        const inviteTeammatesStep = <OnboardingInviteTeammates stepKey={OnboardingStepKey.INVITE_TEAMMATES} />
        steps = [...steps, inviteTeammatesStep]
        setAllSteps(steps)
    }

    return (currentOnboardingStep as JSX.Element) || <></>
}

const ProductAnalyticsOnboarding = (): JSX.Element => {
    const { currentTeam } = useValues(teamLogic)

    const heatmapsEnabled = useFeatureFlag('TOOLBAR_HEATMAPS')

    return (
        <OnboardingWrapper>
            <SDKs
                usersAction="collecting events"
                sdkInstructionMap={ProductAnalyticsSDKInstructions}
                stepKey={OnboardingStepKey.INSTALL}
            />
            <OnboardingProductConfiguration
                stepKey={OnboardingStepKey.PRODUCT_CONFIGURATION}
                options={[
                    {
                        title: 'Autocapture frontend interactions',
                        description: `If you use our JavaScript or React Native libraries, we'll automagically 
                        capture frontend interactions like clicks, submits, and more. Fine-tune what you 
                        capture directly in your code snippet.`,
                        teamProperty: 'autocapture_opt_out',
                        value: !currentTeam?.autocapture_opt_out,
                        type: 'toggle',
                        inverseToggle: true,
                    },

                    heatmapsEnabled
                        ? {
                              title: 'Enable heatmaps',
                              description: `If you use our JavaScript libraries, we can capture general clicks, mouse movements,
                               and scrolling to create heatmaps. 
                               No additional events are created, and you can disable this at any time.`,
                              teamProperty: 'heatmaps_opt_in',
                              value: currentTeam?.heatmaps_opt_in ?? true,
                              type: 'toggle',
                          }
                        : undefined,
                ]}
            />
        </OnboardingWrapper>
    )
}
const SessionReplayOnboarding = (): JSX.Element => {
    const { hasAvailableFeature } = useValues(userLogic)
    const { currentTeam } = useValues(teamLogic)

    const { featureFlags } = useValues(featureFlagLogic)
    const hasAndroidOnBoarding = !!featureFlags[FEATURE_FLAGS.SESSION_REPLAY_MOBILE_ONBOARDING]

    const configOptions: ProductConfigOption[] = [
        {
            type: 'toggle',
            title: 'Capture console logs',
            description: `Capture console logs as a part of user session recordings. 
                            Use the console logs alongside recordings to debug any issues with your app.`,
            teamProperty: 'capture_console_log_opt_in',
            value: currentTeam?.capture_console_log_opt_in ?? true,
        },
        {
            type: 'toggle',
            title: 'Capture network performance',
            description: `Capture performance and network information alongside recordings. Use the
                            network requests and timings in the recording player to help you debug issues with your app.`,
            teamProperty: 'capture_performance_opt_in',
            value: currentTeam?.capture_performance_opt_in ?? true,
        },
    ]

    if (hasAvailableFeature(AvailableFeature.REPLAY_RECORDING_DURATION_MINIMUM)) {
        configOptions.push({
            type: 'select',
            title: 'Minimum session duration (seconds)',
            description: `Only record sessions that are longer than the specified duration. 
                            Start with it low and increase it later if you're getting too many short sessions.`,
            teamProperty: 'session_recording_minimum_duration_milliseconds',
            value: currentTeam?.session_recording_minimum_duration_milliseconds || null,
            selectOptions: SESSION_REPLAY_MINIMUM_DURATION_OPTIONS,
        })
    }

    const sdkInstructionMap = SessionReplaySDKInstructions
    if (hasAndroidOnBoarding) {
        sdkInstructionMap[SDKKey.ANDROID] = AndroidInstructions
    }

    return (
        <OnboardingWrapper>
            <SDKs
                usersAction="recording sessions"
                sdkInstructionMap={sdkInstructionMap}
                subtitle="Choose the framework your frontend is built on, or use our all-purpose JavaScript library. If you already have the snippet installed, you can skip this step!"
                stepKey={OnboardingStepKey.INSTALL}
            />
            <OnboardingProductConfiguration stepKey={OnboardingStepKey.PRODUCT_CONFIGURATION} options={configOptions} />
        </OnboardingWrapper>
    )
}

const FeatureFlagsOnboarding = (): JSX.Element => {
    return (
        <OnboardingWrapper>
            <SDKs
                usersAction="loading flags & experiments"
                sdkInstructionMap={FeatureFlagsSDKInstructions}
                subtitle="Choose the framework where you want to use feature flags and/or run experiments, or use our all-purpose JavaScript library. If you already have the snippet installed, you can skip this step!"
                stepKey={OnboardingStepKey.INSTALL}
            />
        </OnboardingWrapper>
    )
}

const SurveysOnboarding = (): JSX.Element => {
    return (
        <OnboardingWrapper>
            <SDKs
                usersAction="taking surveys"
                sdkInstructionMap={SurveysSDKInstructions}
                subtitle="Choose the framework your frontend is built on, or use our all-purpose JavaScript library. If you already have the snippet installed, you can skip this step!"
                stepKey={OnboardingStepKey.INSTALL}
            />
        </OnboardingWrapper>
    )
}

export function Onboarding(): JSX.Element | null {
    const { product } = useValues(onboardingLogic)

    if (!product) {
        return <></>
    }
    const onboardingViews = {
        [ProductKey.PRODUCT_ANALYTICS]: ProductAnalyticsOnboarding,
        [ProductKey.SESSION_REPLAY]: SessionReplayOnboarding,
        [ProductKey.FEATURE_FLAGS]: FeatureFlagsOnboarding,
        [ProductKey.SURVEYS]: SurveysOnboarding,
    }
    const OnboardingView = onboardingViews[product.type]

    return <OnboardingView />
}
