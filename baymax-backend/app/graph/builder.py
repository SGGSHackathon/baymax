"""
LangGraph builder — assembles and compiles the full agent graph.
Extracted from main_v6.py §19.
"""

import logging

from langgraph.graph import StateGraph, START, END

from app.graph.state import MedState
from app.graph.nodes import (
    load_context, pre_safety, clinical_decision_node, intent_router, post_process,
)
from app.graph.agents import (
    onboarding_agent, conversation_agent, drug_info_agent,
    safety_agent, order_agent, reminder_agent, refill_agent, family_agent,
)
from app.graph.dfe import dynamic_followup_engine
from app.graph.routing import (
    should_onboard, after_presafety, after_cde, route_intent, after_dfe,
)

logger = logging.getLogger("medai.v6")


def build_graph():
    g = StateGraph(MedState)

    # Register nodes
    nodes = {
        "load_context":              load_context,
        "pre_safety":                pre_safety,
        "clinical_decision":         clinical_decision_node,
        "onboarding_agent":          onboarding_agent,
        "intent_router":             intent_router,
        "dynamic_followup_engine":   dynamic_followup_engine,
        "conversation_agent":        conversation_agent,
        "drug_info_agent":           drug_info_agent,
        "safety_agent":              safety_agent,
        "order_agent":               order_agent,
        "reminder_agent":            reminder_agent,
        "refill_agent":              refill_agent,
        "family_agent":              family_agent,
        "post_process":              post_process,
    }
    for name, fn in nodes.items():
        g.add_node(name, fn)

    # Entry
    g.add_edge(START, "load_context")

    # load_context → onboarding or pre_safety
    g.add_conditional_edges("load_context", should_onboard, {
        "onboarding_agent": "onboarding_agent",
        "pre_safety":       "pre_safety",
        "post_process":     "post_process",
    })

    # pre_safety → CDE or post_process
    g.add_conditional_edges("pre_safety", after_presafety, {
        "clinical_decision": "clinical_decision",
        "post_process":      "post_process",
    })

    # CDE → intent_router or post_process (blocked)
    g.add_conditional_edges("clinical_decision", after_cde, {
        "intent_router": "intent_router",
        "post_process":  "post_process",
    })

    # intent_router → DFE (V6: DFE sits between router and agents)
    g.add_conditional_edges("intent_router", route_intent, {
        "conversation_agent": "dynamic_followup_engine",
        "drug_info_agent":    "dynamic_followup_engine",
        "safety_agent":       "dynamic_followup_engine",
        "order_agent":        "order_agent",         # Operational: skip DFE
        "reminder_agent":     "reminder_agent",      # Operational: skip DFE
        "refill_agent":       "refill_agent",        # Operational: skip DFE
        "family_agent":       "family_agent",        # Operational: skip DFE
        "post_process":       "post_process",
    })

    # DFE → post_process (if asked a question) OR target agent (if no question)
    g.add_conditional_edges("dynamic_followup_engine", after_dfe, {
        "conversation_agent": "conversation_agent",
        "drug_info_agent":    "drug_info_agent",
        "safety_agent":       "safety_agent",
        "post_process":       "post_process",
    })

    # All agents → post_process → END
    for agent in ["onboarding_agent", "conversation_agent", "drug_info_agent",
                  "safety_agent", "order_agent", "reminder_agent", "refill_agent",
                  "family_agent"]:
        g.add_edge(agent, "post_process")
    g.add_edge("post_process", END)

    return g.compile()
