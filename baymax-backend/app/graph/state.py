"""
MedState TypedDict — shared LangGraph state definition.
Extracted from main_v6.py §16.
"""

from typing import Optional
from typing_extensions import TypedDict


class MedState(TypedDict):
    # Request
    phone:            str
    message:          str
    original_message: Optional[str]        # pre-translation user text
    session_id:       str
    channel:          str
    # User context
    user:             dict
    is_new_user:      bool
    history:          list[dict]
    session_summary:  Optional[str]
    # Routing
    intent:           str
    intent_conf:      float
    drugs_found:      list[str]
    emergency:        bool
    triage_level:     str
    blocked_drug:     Optional[str]
    caregiver_ctx:    Optional[str]
    patient_id:       Optional[str]
    # V5
    risk_tier:        int
    cde_result:       Optional[dict]
    active_episode_id:Optional[str]
    # RAG / output
    rag_context:      list[dict]
    selected_inv:     Optional[dict]
    order_record:     Optional[dict]
    reply:            str
    agent_used:       str
    safety_flags:     list[str]
    requires_action:  Optional[str]
    # Active transactional flow (from Redis pending state)
    active_flow:      Optional[dict]         # {flow, stage, drug, inventory, ...}
    conv_memory:      Optional[dict]         # Redis working memory
    # V6 additions
    dfe_triggered:    bool
    dfe_question:     Optional[str]          # The question DFE generated
    dfe_context:      Optional[dict]         # Clinical context used by DFE
    web_search_used:  bool
    web_search_source:Optional[str]          # Domain that was used
    behavioral_profile: Optional[dict]       # short_replies, ignores, anxiety
