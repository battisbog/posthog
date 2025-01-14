import { actions, afterMount, beforeUnmount, connect, kea, listeners, path, reducers, selectors } from 'kea'
import { loaders } from 'kea-loaders'
import { encodeParams } from 'kea-router'
import { subscriptions } from 'kea-subscriptions'
import { windowValues } from 'kea-window-values'
import { elementToSelector, escapeRegex } from 'lib/actionUtils'
import { PaginatedResponse } from 'lib/api'
import { dateFilterToText } from 'lib/utils'
import { PostHog } from 'posthog-js'
import { collectAllElementsDeep, querySelectorAllDeep } from 'query-selector-shadow-dom'

import { currentPageLogic } from '~/toolbar/stats/currentPageLogic'
import { toolbarConfigLogic, toolbarFetch } from '~/toolbar/toolbarConfigLogic'
import { toolbarPosthogJS } from '~/toolbar/toolbarPosthogJS'
import {
    CountedHTMLElement,
    ElementsEventType,
    HeatmapElement,
    HeatmapRequestType,
    HeatmapResponseType,
} from '~/toolbar/types'
import { elementToActionStep, trimElement } from '~/toolbar/utils'
import { FilterType, PropertyFilterType, PropertyOperator } from '~/types'

import type { heatmapLogicType } from './heatmapLogicType'

export const SCROLL_DEPTH_JS_VERSION = [1, 99]

const emptyElementsStatsPages: PaginatedResponse<ElementsEventType> = {
    next: undefined,
    previous: undefined,
    results: [],
}

export type CommonFilters = {
    date_from?: string
    date_to?: string
}

export type HeatmapFilters = {
    enabled: boolean
    type?: string
    viewportAccuracy?: number
    aggregation?: HeatmapRequestType['aggregation']
}

export type HeatmapJsDataPoint = {
    x: number
    y: number
    value: number
}

export type HeatmapJsData = {
    data: HeatmapJsDataPoint[]
    max: number
    min: number
}
export type HeatmapFixedPositionMode = 'fixed' | 'relative' | 'hidden'

export const heatmapLogic = kea<heatmapLogicType>([
    path(['toolbar', 'elements', 'heatmapLogic']),
    connect({
        values: [currentPageLogic, ['href', 'wildcardHref'], toolbarConfigLogic, ['posthog']],
        actions: [currentPageLogic, ['setHref', 'setWildcardHref']],
    }),
    actions({
        getElementStats: (url?: string | null) => ({
            url,
        }),
        enableHeatmap: true,
        disableHeatmap: true,
        setShiftPressed: (shiftPressed: boolean) => ({ shiftPressed }),
        setCommonFilters: (filters: CommonFilters) => ({ filters }),
        setHeatmapFilters: (filters: HeatmapFilters) => ({ filters }),
        patchHeatmapFilters: (filters: Partial<HeatmapFilters>) => ({ filters }),
        toggleClickmapsEnabled: (enabled?: boolean) => ({ enabled }),

        loadMoreElementStats: true,
        setMatchLinksByHref: (matchLinksByHref: boolean) => ({ matchLinksByHref }),
        loadHeatmap: (type: string) => ({
            type,
        }),
        loadAllEnabled: (delayMs: number = 0) => ({ delayMs }),
        maybeLoadClickmap: (delayMs: number = 0) => ({ delayMs }),
        maybeLoadHeatmap: (delayMs: number = 0) => ({ delayMs }),
        fetchHeatmapApi: (params: HeatmapRequestType) => ({ params }),
        setHeatmapScrollY: (scrollY: number) => ({ scrollY }),
        setHeatmapFixedPositionMode: (mode: HeatmapFixedPositionMode) => ({ mode }),
    }),
    windowValues(() => ({
        windowWidth: (window: Window) => window.innerWidth,
        windowHeight: (window: Window) => window.innerHeight,
    })),
    reducers({
        matchLinksByHref: [false, { setMatchLinksByHref: (_, { matchLinksByHref }) => matchLinksByHref }],
        canLoadMoreElementStats: [
            true,
            {
                getElementStatsSuccess: (_, { elementStats }) => elementStats.next !== null,
                getElementStatsFailure: () => true, // so at least someone can recover from transient errors
            },
        ],
        heatmapEnabled: [
            false,
            {
                enableHeatmap: () => true,
                disableHeatmap: () => false,
                getElementStatsFailure: () => false,
            },
        ],
        shiftPressed: [
            false,
            {
                setShiftPressed: (_, { shiftPressed }) => shiftPressed,
            },
        ],
        commonFilters: [
            {} as CommonFilters,
            {
                setCommonFilters: (_, { filters }) => filters,
            },
        ],
        heatmapFilters: [
            {
                enabled: true,
                type: 'click',
                viewportAccuracy: 0.9,
                aggregation: 'total_count',
            } as HeatmapFilters,
            { persist: true },
            {
                setHeatmapFilters: (_, { filters }) => filters,
                patchHeatmapFilters: (state, { filters }) => ({ ...state, ...filters }),
            },
        ],
        clickmapsEnabled: [
            true,
            { persist: true },
            {
                toggleClickmapsEnabled: (state, { enabled }) => (enabled === undefined ? !state : enabled),
            },
        ],
        heatmapScrollY: [
            0,
            {
                setHeatmapScrollY: (_, { scrollY }) => scrollY,
            },
        ],

        heatmapFixedPositionMode: [
            'fixed' as HeatmapFixedPositionMode,
            {
                setHeatmapFixedPositionMode: (_, { mode }) => mode,
            },
        ],
    }),

    loaders(({ values }) => ({
        elementStats: [
            null as PaginatedResponse<ElementsEventType> | null,
            {
                resetElementStats: () => emptyElementsStatsPages,
                getElementStats: async ({ url }, breakpoint) => {
                    const { href, wildcardHref } = values
                    let defaultUrl: string = ''
                    if (!url) {
                        const params: Partial<FilterType> = {
                            properties: [
                                wildcardHref === href
                                    ? {
                                          key: '$current_url',
                                          value: href,
                                          operator: PropertyOperator.Exact,
                                          type: PropertyFilterType.Event,
                                      }
                                    : {
                                          key: '$current_url',
                                          value: `^${wildcardHref.split('*').map(escapeRegex).join('.*')}$`,
                                          operator: PropertyOperator.Regex,
                                          type: PropertyFilterType.Event,
                                      },
                            ],
                            date_from: values.commonFilters.date_from,
                            date_to: values.commonFilters.date_to,
                        }

                        defaultUrl = `/api/element/stats/${encodeParams({ ...params, paginate_response: true }, '?')}`
                    }

                    // toolbar fetch collapses queryparams but this URL has multiple with the same name
                    const response = await toolbarFetch(
                        url || defaultUrl,
                        'GET',
                        undefined,
                        url ? 'use-as-provided' : 'full'
                    )

                    if (response.status === 403) {
                        toolbarConfigLogic.actions.authenticate()
                        return emptyElementsStatsPages
                    }

                    const paginatedResults = await response.json()
                    breakpoint()

                    if (!Array.isArray(paginatedResults.results)) {
                        throw new Error('Error loading HeatMap data!')
                    }

                    return {
                        results: [...(values.elementStats?.results || []), ...paginatedResults.results],
                        next: paginatedResults.next,
                        previous: paginatedResults.previous,
                    } as PaginatedResponse<ElementsEventType>
                },
            },
        ],

        rawHeatmap: [
            null as HeatmapResponseType | null,
            {
                loadHeatmap: async () => {
                    const { href, wildcardHref } = values
                    const { date_from, date_to } = values.commonFilters
                    const { type, aggregation } = values.heatmapFilters
                    const urlExact = wildcardHref === href ? href : undefined
                    const urlRegex = wildcardHref !== href ? wildcardHref : undefined

                    // toolbar fetch collapses queryparams but this URL has multiple with the same name
                    const response = await toolbarFetch(
                        `/api/heatmap/${encodeParams(
                            {
                                type,
                                date_from,
                                date_to,
                                url_exact: urlExact,
                                url_pattern: urlRegex,
                                viewport_width_min: values.viewportRange.min,
                                viewport_width_max: values.viewportRange.max,
                                aggregation,
                            },
                            '?'
                        )}`,
                        'GET'
                    )

                    if (response.status === 403) {
                        toolbarConfigLogic.actions.authenticate()
                    }

                    if (response.status !== 200) {
                        throw new Error('API error')
                    }

                    return await response.json()
                },
            },
        ],
    })),

    selectors(({ cache }) => ({
        dateRange: [
            (s) => [s.commonFilters],
            (commonFilters: Partial<FilterType>) => {
                return dateFilterToText(commonFilters.date_from, commonFilters.date_to, 'Last 7 days')
            },
        ],
        elements: [
            (s) => [s.elementStats, toolbarConfigLogic.selectors.dataAttributes, s.href, s.matchLinksByHref],
            (elementStats, dataAttributes, href, matchLinksByHref) => {
                cache.pageElements = cache.lastHref == href ? cache.pageElements : collectAllElementsDeep('*', document)
                cache.selectorToElements = cache.lastHref == href ? cache.selectorToElements : {}

                cache.lastHref = href

                const elements: CountedHTMLElement[] = []
                elementStats?.results.forEach((event) => {
                    let combinedSelector: string
                    let lastSelector: string | undefined
                    for (let i = 0; i < event.elements.length; i++) {
                        const element = event.elements[i]
                        const selector =
                            elementToSelector(
                                matchLinksByHref ? element : { ...element, href: undefined },
                                dataAttributes
                            ) || '*'
                        combinedSelector = lastSelector ? `${selector} > ${lastSelector}` : selector

                        try {
                            let domElements: HTMLElement[] | undefined = cache.selectorToElements?.[combinedSelector]
                            if (domElements === undefined) {
                                domElements = Array.from(
                                    querySelectorAllDeep(combinedSelector, document, cache.pageElements)
                                )
                                cache.selectorToElements[combinedSelector] = domElements
                            }

                            if (domElements.length === 1) {
                                const e = event.elements[i]

                                // element like "svg" (only tag, no class/id/etc.) as the first one
                                if (
                                    i === 0 &&
                                    e.tag_name &&
                                    !e.attr_class &&
                                    !e.attr_id &&
                                    !e.href &&
                                    !e.text &&
                                    e.nth_child === 1 &&
                                    e.nth_of_type === 1 &&
                                    !e.attributes['attr__data-attr']
                                ) {
                                    // too simple selector, bail
                                } else {
                                    elements.push({
                                        element: domElements[0],
                                        count: event.count,
                                        selector: selector,
                                        hash: event.hash,
                                        type: event.type,
                                    } as CountedHTMLElement)
                                    return null
                                }
                            }

                            if (domElements.length === 0) {
                                if (i === event.elements.length - 1) {
                                    return null
                                } else if (i > 0 && lastSelector) {
                                    // We already have something, but found nothing when adding the next selector.
                                    // Skip it and try with the next one...
                                    lastSelector = lastSelector ? `* > ${lastSelector}` : '*'
                                    continue
                                }
                            }
                        } catch (error) {
                            break
                        }

                        lastSelector = combinedSelector

                        // TODO: what if multiple elements will continue to match until the end?
                    }
                })

                return elements
            },
        ],
        countedElements: [
            (s) => [s.elements, toolbarConfigLogic.selectors.dataAttributes, s.clickmapsEnabled],
            (elements, dataAttributes, clickmapsEnabled) => {
                if (!clickmapsEnabled) {
                    return []
                }
                const normalisedElements = new Map<HTMLElement, CountedHTMLElement>()
                ;(elements || []).forEach((countedElement) => {
                    const trimmedElement = trimElement(countedElement.element)
                    if (!trimmedElement) {
                        return
                    }

                    if (normalisedElements.has(trimmedElement)) {
                        const existing = normalisedElements.get(trimmedElement)
                        if (existing) {
                            existing.count += countedElement.count
                            existing.clickCount += countedElement.type === '$rageclick' ? 0 : countedElement.count
                            existing.rageclickCount += countedElement.type === '$rageclick' ? countedElement.count : 0
                        }
                    } else {
                        normalisedElements.set(trimmedElement, {
                            ...countedElement,
                            clickCount: countedElement.type === '$rageclick' ? 0 : countedElement.count,
                            rageclickCount: countedElement.type === '$rageclick' ? countedElement.count : 0,
                            element: trimmedElement,
                            actionStep: elementToActionStep(trimmedElement, dataAttributes),
                        })
                    }
                })

                const countedElements = Array.from(normalisedElements.values())
                countedElements.sort((a, b) => b.count - a.count)

                return countedElements.map((e, i) => ({ ...e, position: i + 1 }))
            },
        ],
        elementCount: [(s) => [s.countedElements], (countedElements) => countedElements.length],
        clickCount: [
            (s) => [s.countedElements],
            (countedElements) => (countedElements ? countedElements.map((e) => e.count).reduce((a, b) => a + b, 0) : 0),
        ],
        highestClickCount: [
            (s) => [s.countedElements],
            (countedElements) =>
                countedElements ? countedElements.map((e) => e.count).reduce((a, b) => (b > a ? b : a), 0) : 0,
        ],

        heatmapElements: [
            (s) => [s.rawHeatmap],
            (rawHeatmap): HeatmapElement[] => {
                if (!rawHeatmap) {
                    return []
                }

                const elements: HeatmapElement[] = []

                rawHeatmap?.results.forEach((element) => {
                    if ('scroll_depth_bucket' in element) {
                        elements.push({
                            count: element.cumulative_count,
                            xPercentage: 0,
                            targetFixed: false,
                            y: element.scroll_depth_bucket,
                        })
                    } else {
                        elements.push({
                            count: element.count,
                            xPercentage: element.pointer_relative_x,
                            targetFixed: element.pointer_target_fixed,
                            y: element.pointer_y,
                        })
                    }
                })

                return elements
            },
        ],

        viewportRange: [
            (s) => [s.heatmapFilters, s.windowWidth],
            (heatmapFilters, windowWidth): { max: number; min: number } => {
                const viewportAccuracy = heatmapFilters.viewportAccuracy ?? 0.2
                const extraPixels = windowWidth - windowWidth * viewportAccuracy

                const minWidth = Math.max(0, windowWidth - extraPixels)
                const maxWidth = windowWidth + extraPixels

                return {
                    min: Math.round(minWidth),
                    max: Math.round(maxWidth),
                }
            },
        ],

        scrollDepthPosthogJsError: [
            (s) => [s.posthog],
            (posthog: PostHog): 'version' | 'disabled' | null => {
                const posthogVersion = posthog?._calculate_event_properties('test', {})?.['$lib_version'] ?? '0.0.0'
                const majorMinorVersion = posthogVersion.split('.')
                const majorVersion = parseInt(majorMinorVersion[0], 10)
                const minorVersion = parseInt(majorMinorVersion[1], 10)

                if (!(posthog as any)?.scrollManager?.scrollY) {
                    return 'version'
                }

                const isSupported =
                    majorVersion > SCROLL_DEPTH_JS_VERSION[0] ||
                    (majorVersion === SCROLL_DEPTH_JS_VERSION[0] && minorVersion >= SCROLL_DEPTH_JS_VERSION[1])
                const isDisabled = posthog?.config.disable_scroll_properties

                return !isSupported ? 'version' : isDisabled ? 'disabled' : null
            },
        ],

        heatmapJsData: [
            (s) => [s.heatmapElements, s.heatmapScrollY, s.windowWidth, s.heatmapFixedPositionMode],
            (heatmapElements, heatmapScrollY, windowWidth, heatmapFixedPositionMode): HeatmapJsData => {
                // We want to account for all the fixed position elements, the scroll of the context and the browser width
                const data = heatmapElements.reduce((acc, element) => {
                    if (heatmapFixedPositionMode === 'hidden' && element.targetFixed) {
                        return acc
                    }

                    const y = Math.round(
                        element.targetFixed && heatmapFixedPositionMode === 'fixed'
                            ? element.y
                            : element.y - heatmapScrollY
                    )
                    const x = Math.round(element.xPercentage * windowWidth)

                    return [...acc, { x, y, value: element.count }]
                }, [] as HeatmapJsDataPoint[])

                // Max is the highest value in the data set we have
                const max = data.reduce((max, { value }) => Math.max(max, value), 0)

                // TODO: Group based on some sensible resolutions (we can then use this for a hover state to show more detail)

                return {
                    min: 0,
                    max,
                    data,
                }
            },
        ],
    })),

    subscriptions(({ actions }) => ({
        viewportRange: () => {
            actions.maybeLoadHeatmap(500)
        },
    })),

    listeners(({ actions, values }) => ({
        fetchHeatmapApi: async () => {
            const { href, wildcardHref } = values
            const { date_from, date_to } = values.commonFilters
            const { type, aggregation } = values.heatmapFilters
            const urlExact = wildcardHref === href ? href : undefined
            const urlRegex = wildcardHref !== href ? wildcardHref : undefined

            // toolbar fetch collapses queryparams but this URL has multiple with the same name
            const response = await toolbarFetch(
                `/api/heatmap/${encodeParams(
                    {
                        type,
                        date_from,
                        date_to,
                        url_exact: urlExact,
                        url_pattern: urlRegex,
                        viewport_width_min: values.viewportRange.min,
                        viewport_width_max: values.viewportRange.max,
                        aggregation,
                    },
                    '?'
                )}`,
                'GET'
            )

            if (response.status === 403) {
                toolbarConfigLogic.actions.authenticate()
            }

            if (response.status !== 200) {
                throw new Error('API error')
            }

            return await response.json()
        },
        enableHeatmap: () => {
            actions.loadAllEnabled()
            toolbarPosthogJS.capture('toolbar mode triggered', { mode: 'heatmap', enabled: true })
        },
        disableHeatmap: () => {
            actions.resetElementStats()
            toolbarPosthogJS.capture('toolbar mode triggered', { mode: 'heatmap', enabled: false })
        },

        loadAllEnabled: async ({ delayMs }, breakpoint) => {
            await breakpoint(delayMs)

            actions.maybeLoadHeatmap()
            actions.maybeLoadClickmap()
        },
        maybeLoadClickmap: async ({ delayMs }, breakpoint) => {
            await breakpoint(delayMs)
            if (values.heatmapEnabled && values.clickmapsEnabled) {
                actions.getElementStats()
            }
        },

        maybeLoadHeatmap: async ({ delayMs }, breakpoint) => {
            await breakpoint(delayMs)
            if (values.heatmapEnabled) {
                if (values.heatmapFilters.enabled && values.heatmapFilters.type) {
                    actions.loadHeatmap(values.heatmapFilters.type)
                }
            }
        },

        setHref: () => {
            actions.loadAllEnabled()
        },
        setWildcardHref: () => {
            actions.loadAllEnabled(1000)
        },
        setCommonFilters: () => {
            actions.loadAllEnabled(200)
        },

        // Only trigger element stats loading if clickmaps are enabled
        toggleClickmapsEnabled: () => {
            if (values.clickmapsEnabled) {
                actions.getElementStats()
            }
        },

        loadMoreElementStats: () => {
            if (values.elementStats?.next) {
                actions.getElementStats(values.elementStats.next)
            }
        },

        patchHeatmapFilters: ({ filters }) => {
            if (filters.type) {
                // Clear the heatmap if the type changes
                actions.loadHeatmapSuccess({ results: [] })
            }
            actions.maybeLoadHeatmap(200)
        },
    })),

    afterMount(({ actions, values, cache }) => {
        actions.loadAllEnabled()
        cache.keyDownListener = (event: KeyboardEvent) => {
            if (event.shiftKey && !values.shiftPressed) {
                actions.setShiftPressed(true)
            }
        }
        cache.keyUpListener = (event: KeyboardEvent) => {
            if (!event.shiftKey && values.shiftPressed) {
                actions.setShiftPressed(false)
            }
        }
        window.addEventListener('keydown', cache.keyDownListener)
        window.addEventListener('keyup', cache.keyUpListener)

        cache.scrollCheckTimer = setInterval(() => {
            const scrollY = (values.posthog as any)?.scrollManager?.scrollY() ?? 0
            if (values.heatmapScrollY !== scrollY) {
                actions.setHeatmapScrollY(scrollY)
            }
        }, 100)
    }),

    beforeUnmount(({ cache }) => {
        window.removeEventListener('keydown', cache.keyDownListener)
        window.removeEventListener('keyup', cache.keyUpListener)
        clearInterval(cache.scrollCheckTimer)
    }),
])
